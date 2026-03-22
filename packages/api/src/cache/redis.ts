import Redis from 'ioredis';
import { REDIS_MAX_RETRIES, REDIS_CONNECT_TIMEOUT_MS } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('redis');

const FALLBACK_MAX_SIZE = 10_000;
const FALLBACK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let client: Redis | null = null;
let subscriberClient: Redis | null = null;
let fallbackMap: Map<string, { value: string; expiresAt: number }> | null = null;
let fallbackCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function getRedisClient(): Redis | null {
  return client;
}

export function getSubscriberClient(): Redis | null {
  return subscriberClient;
}

export async function initRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    log.info('REDIS_URL not set, using in-memory fallback');
    fallbackMap = new Map();
    fallbackCleanupTimer = setInterval(() => {
      if (!fallbackMap) return;
      const now = Date.now();
      for (const [key, entry] of fallbackMap) {
        if (now > entry.expiresAt) fallbackMap.delete(key);
      }
    }, FALLBACK_CLEANUP_INTERVAL_MS);
    return;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: REDIS_MAX_RETRIES,
      lazyConnect: true,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    });

    client.on('error', (err) => {
      log.error({ err }, 'Connection error');
    });

    await client.connect();
    log.info('Connected');

    subscriberClient = client.duplicate();
    subscriberClient.on('error', (err) => {
      log.error({ err }, 'Subscriber connection error');
    });
    await subscriberClient.connect();
  } catch (err) {
    log.warn({ err }, 'Failed to connect, using in-memory fallback');
    client = null;
    fallbackMap = new Map();
  }
}

export async function closeRedis(): Promise<void> {
  if (subscriberClient) {
    await subscriberClient.quit();
    subscriberClient = null;
  }
  if (client) {
    await client.quit();
    client = null;
  }
  if (fallbackCleanupTimer) {
    clearInterval(fallbackCleanupTimer);
    fallbackCleanupTimer = null;
  }
  fallbackMap = null;
}

/**
 * Retrieve a JSON-serialised value from cache.
 * NOTE: The returned value is parsed JSON cast to T — the CALLER is responsible
 * for validating the shape before using it for security-critical decisions.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (client) {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  if (fallbackMap) {
    const entry = fallbackMap.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      fallbackMap.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  return null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const json = JSON.stringify(value);

  if (client) {
    await client.set(key, json, 'EX', ttlSeconds);
    return;
  }

  if (fallbackMap) {
    // Reject individual values larger than 1MB to prevent memory abuse
    if (json.length > 1_048_576) return;

    // Evict oldest entries if at capacity
    if (fallbackMap.size >= FALLBACK_MAX_SIZE) {
      const evictCount = Math.floor(FALLBACK_MAX_SIZE * 0.1);
      const iter = fallbackMap.keys();
      for (let i = 0; i < evictCount; i++) {
        const next = iter.next();
        if (next.done) break;
        fallbackMap.delete(next.value);
      }
    }
    fallbackMap.set(key, {
      value: json,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

export async function cacheDel(pattern: string): Promise<void> {
  if (client) {
    // If no glob characters, delete directly (O(1))
    if (!pattern.includes('*') && !pattern.includes('?')) {
      await client.del(pattern);
      return;
    }
    const stream = client.scanStream({ match: pattern, count: 100 });
    const pipeline = client.pipeline();
    let count = 0;
    for await (const keys of stream) {
      for (const key of keys as string[]) {
        pipeline.del(key);
        count++;
      }
    }
    if (count > 0) {
      await pipeline.exec();
    }
    return;
  }

  if (fallbackMap) {
    // If no glob characters, delete directly
    if (!pattern.includes('*') && !pattern.includes('?')) {
      fallbackMap.delete(pattern);
      return;
    }
    // Convert glob pattern to regex for proper matching
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
    );
    for (const key of fallbackMap.keys()) {
      if (regex.test(key)) {
        fallbackMap.delete(key);
      }
    }
  }
}

// ============================================================
// Hash-based cache operations (Redis HSET/HGET/HDEL)
// ============================================================

/**
 * Retrieve a JSON-serialised value from a Redis hash field.
 * NOTE: The returned value is parsed JSON cast to T — the CALLER is responsible
 * for validating the shape before using it for security-critical decisions.
 */
export async function cacheHashGet<T>(key: string, field: string): Promise<T | null> {
  if (client) {
    const raw = await client.hget(key, field);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  if (fallbackMap) {
    const entry = fallbackMap.get(`${key}:${field}`);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      fallbackMap.delete(`${key}:${field}`);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  return null;
}

export async function cacheHashSet(
  key: string,
  field: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const json = JSON.stringify(value);

  if (client) {
    // Pipeline HSET+EXPIRE to reduce round trips
    const pipeline = client.pipeline();
    pipeline.hset(key, field, json);
    pipeline.expire(key, ttlSeconds);
    await pipeline.exec();
    return;
  }

  if (fallbackMap) {
    const compositeKey = `${key}:${field}`;
    if (fallbackMap.size >= FALLBACK_MAX_SIZE) {
      const evictCount = Math.floor(FALLBACK_MAX_SIZE * 0.1);
      const iter = fallbackMap.keys();
      for (let i = 0; i < evictCount; i++) {
        const next = iter.next();
        if (next.done) break;
        fallbackMap.delete(next.value);
      }
    }
    fallbackMap.set(compositeKey, {
      value: json,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

/** Delete an entire hash key (all fields). O(1) for Redis, prefix scan for fallback. */
export async function cacheHashDelAll(key: string): Promise<void> {
  if (client) {
    await client.del(key);
    return;
  }

  if (fallbackMap) {
    const prefix = `${key}:`;
    for (const k of fallbackMap.keys()) {
      if (k.startsWith(prefix)) {
        fallbackMap.delete(k);
      }
    }
  }
}
