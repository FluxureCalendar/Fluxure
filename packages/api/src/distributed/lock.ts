import { randomUUID } from 'crypto';
import { getRedisClient } from '../cache/redis.js';
import { createLogger } from '../logger.js';

const log = createLogger('distributed-lock');

export interface LockHandle {
  key: string;
  token: string;
}

/** Lua script: atomic check-and-delete (only release if we own the lock). */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** In-memory fallback when Redis is unavailable. */
const fallbackLocks = new Map<string, string>();

export class LockNotAcquiredError extends Error {
  constructor(key: string) {
    super(`Failed to acquire lock: ${key}`);
    this.name = 'LockNotAcquiredError';
  }
}

/**
 * Acquire a distributed lock.
 * Uses Redis SET NX PX when available, falls back to in-memory Map.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<LockHandle | null> {
  const token = randomUUID();
  const redis = getRedisClient();

  if (redis) {
    const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return { key, token };
    }
    return null;
  }

  // In-memory fallback
  if (fallbackLocks.has(key)) {
    return null;
  }
  fallbackLocks.set(key, token);
  setTimeout(() => {
    if (fallbackLocks.get(key) === token) {
      fallbackLocks.delete(key);
    }
  }, ttlMs);
  return { key, token };
}

/**
 * Release a distributed lock.
 * Uses Lua script for atomic check-and-delete in Redis, or simple Map delete for fallback.
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    // ioredis eval() executes a Lua script on Redis server — this is the standard
    // pattern for atomic lock release, not JavaScript eval().
    await redis.eval(RELEASE_SCRIPT, 1, handle.key, handle.token);
    return;
  }

  // In-memory fallback
  if (fallbackLocks.get(handle.key) === handle.token) {
    fallbackLocks.delete(handle.key);
  }
}

/**
 * Execute a function while holding a distributed lock.
 * Throws LockNotAcquiredError if the lock cannot be obtained.
 */
export async function withDistributedLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await acquireLock(key, ttlMs);
  if (!handle) {
    throw new LockNotAcquiredError(key);
  }

  try {
    return await fn();
  } finally {
    try {
      await releaseLock(handle);
    } catch (err) {
      log.warn({ err, key }, 'Failed to release lock');
    }
  }
}
