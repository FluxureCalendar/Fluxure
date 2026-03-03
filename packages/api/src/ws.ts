import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import {
  WS_PATH,
  WS_IP_RATE_WINDOW_MS,
  WS_IP_RATE_MAX,
  WS_MAX_CONNECTIONS_PER_USER,
  WS_MAX_TOTAL_CONNECTIONS,
  WS_IP_CLEANUP_INTERVAL_MS,
  WS_COMPRESSION_LEVEL,
  WS_COMPRESSION_THRESHOLD,
  WS_HEARTBEAT_BASE_MS,
  WS_HEARTBEAT_JITTER_MS,
  WS_CLOSE_UNAUTHORIZED,
  WS_CLOSE_TOO_MANY,
  WS_BROADCAST_DEBOUNCE_MS,
} from '@fluxure/shared';
import { verifyAccessToken, getAccessTokenCookieName } from './auth/jwt.js';
import { schedulerRegistry } from './scheduler-registry.js';
import { allowedOrigins } from './config.js';
import { getRedisClient, getSubscriberClient } from './cache/redis.js';
import { INSTANCE_ID } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('ws');

const WS_BROADCAST_CHANNEL = 'ws:broadcast';
const WS_ACTIVE_TTL_SECONDS = 30;
const WS_ACTIVE_REFRESH_MS = 20_000;

// Allowed event types for WebSocket broadcast messages
const ALLOWED_WS_EVENTS = new Set([
  'schedule_updated',
  'schedule_changes',
  'settings_updated',
  'calendars_updated',
  'system_message',
  'google_auth_required',
  'plan_updated',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate and parse a Redis Pub/Sub broadcast message */
function parseBroadcastMessage(
  raw: string,
): { userId: string; event: string; reason: string; data?: unknown } | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { userId, event, reason, data } = parsed;
    if (typeof event !== 'string' || !ALLOWED_WS_EVENTS.has(event)) return null;
    if (typeof reason !== 'string') return null;
    if (userId !== '__broadcast__' && (typeof userId !== 'string' || !UUID_RE.test(userId)))
      return null;
    return { userId, event, reason, data };
  } catch {
    return null;
  }
}

let wss: WebSocketServer | null = null;
let activeConnectionRefreshTimer: ReturnType<typeof setInterval> | null = null;

// Per-user WebSocket channels
const userChannels = new Map<string, Set<WebSocket>>();

// --- Rate limiting ---

// Per-IP sliding window for upgrade attempts (in-memory fallback when Redis unavailable)
const ipAttempts = new Map<string, number[]>();
let ipCleanupTimer: ReturnType<typeof setInterval> | null = null;

const WS_RATE_WINDOW_SECONDS = Math.ceil(WS_IP_RATE_WINDOW_MS / 1000);

async function isIpRateLimitedRedis(ip: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return isIpRateLimitedLocal(ip);

  try {
    const key = `ws:rate:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WS_RATE_WINDOW_SECONDS);
    }
    return count > WS_IP_RATE_MAX;
  } catch {
    // Redis error — fall back to in-memory
    return isIpRateLimitedLocal(ip);
  }
}

function isIpRateLimitedLocal(ip: string): boolean {
  const now = Date.now();
  const attempts = ipAttempts.get(ip) ?? [];
  // Drop attempts outside the window
  const recent = attempts.filter((t) => now - t < WS_IP_RATE_WINDOW_MS);
  recent.push(now);
  ipAttempts.set(ip, recent);
  return recent.length > WS_IP_RATE_MAX;
}

function cleanupStaleIpEntries(): void {
  const now = Date.now();
  for (const [ip, attempts] of ipAttempts) {
    const recent = attempts.filter((t) => now - t < WS_IP_RATE_WINDOW_MS);
    if (recent.length === 0) {
      ipAttempts.delete(ip);
    } else {
      ipAttempts.set(ip, recent);
    }
  }
}

function parseAccessTokenFromCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookieName = getAccessTokenCookieName();
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name === cookieName) {
      return rest.join('=');
    }
  }
  return null;
}

function authenticateWs(req: IncomingMessage): string | null {
  // Only use httpOnly cookies for auth (same-origin SvelteKit always sends them)
  const token = parseAccessTokenFromCookies(req.headers.cookie);
  if (!token) return null;

  try {
    const payload = verifyAccessToken(token);
    if (!payload.emailVerified) return null;
    // Allow WS connections regardless of GDPR consent status.
    // Non-consented users can receive system_message and calendars_updated events
    // but the scheduler won't run (gated by GDPR consent check in scheduling), so no schedule data leaks.
    return payload.userId;
  } catch {
    return null;
  }
}

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({
    server,
    path: WS_PATH,
    perMessageDeflate: {
      zlibDeflateOptions: { level: WS_COMPRESSION_LEVEL },
      threshold: WS_COMPRESSION_THRESHOLD,
    },
    verifyClient: ({ req }, cb) => {
      // Global connection cap — reject before doing any auth work
      if (wss!.clients.size >= WS_MAX_TOTAL_CONNECTIONS) {
        cb(false, 503, 'Server at capacity');
        return;
      }

      // Per-IP rate limiting on upgrade attempts
      // Only trust x-forwarded-for when TRUST_PROXY is configured (i.e., behind a reverse proxy)
      const trustProxy = parseInt(process.env.TRUST_PROXY ?? '0', 10);
      const forwarded =
        trustProxy > 0
          ? req.headers['x-forwarded-for']?.toString().split(',').shift()?.trim()
          : undefined;
      const ip = forwarded ?? req.socket.remoteAddress ?? 'unknown';

      isIpRateLimitedRedis(ip)
        .then((limited) => {
          if (limited) {
            cb(false, 429, 'Too many connection attempts');
            return;
          }

          const origin = req.headers.origin;
          if (origin && allowedOrigins.includes(origin)) {
            cb(true);
          } else {
            cb(false, 403, 'Origin not allowed');
          }
        })
        .catch(() => {
          cb(false, 500, 'Rate limit check failed');
        });
    },
  });

  // Subscribe to Redis Pub/Sub for cross-instance broadcast
  const subscriber = getSubscriberClient();
  if (subscriber) {
    subscriber.subscribe(WS_BROADCAST_CHANNEL).catch((err) => {
      log.warn({ err }, 'Failed to subscribe to ws:broadcast channel');
    });
    subscriber.on('message', (channel, message) => {
      if (channel !== WS_BROADCAST_CHANNEL) return;
      const parsed = parseBroadcastMessage(message);
      if (!parsed) {
        log.warn('Rejected invalid ws:broadcast message');
        return;
      }
      const { userId, event, reason, data } = parsed;
      if (userId === '__broadcast__') {
        deliverToAllLocally(event, reason, data);
      } else {
        deliverLocally(userId, event, reason, data);
      }
    });
  }

  // Refresh TTLs on Redis active connection keys every 20s
  activeConnectionRefreshTimer = setInterval(() => {
    const redis = getRedisClient();
    if (!redis) return;
    for (const [userId] of userChannels) {
      redis
        .set(`ws:active:${userId}:${INSTANCE_ID}`, '1', 'EX', WS_ACTIVE_TTL_SECONDS)
        .catch((err) => {
          log.warn({ err, userId }, 'Failed to refresh WS active TTL in Redis');
        });
    }
  }, WS_ACTIVE_REFRESH_MS);

  // Heartbeat: ping every ~30s with jitter to avoid thundering herd
  const heartbeat = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      const extWs = ws as WebSocket & { isAlive?: boolean; userId?: string };
      if (extWs.isAlive === false) return extWs.terminate();
      extWs.isAlive = false;
      // Stagger pings with random jitter
      const jitter = Math.floor(Math.random() * WS_HEARTBEAT_JITTER_MS);
      setTimeout(() => {
        extWs.ping();
      }, jitter);
    });
  }, WS_HEARTBEAT_BASE_MS);

  // Periodic cleanup of stale IP rate-limit entries
  ipCleanupTimer = setInterval(cleanupStaleIpEntries, WS_IP_CLEANUP_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeat);
    if (ipCleanupTimer) clearInterval(ipCleanupTimer);
  });

  wss.on('connection', (rawWs: WebSocket, req: IncomingMessage) => {
    const ws = rawWs as WebSocket & { isAlive?: boolean; userId?: string };
    const userId = authenticateWs(req);
    if (!userId) {
      ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized');
      return;
    }

    // Per-user connection cap
    const existing = userChannels.get(userId);
    if (existing && existing.size >= WS_MAX_CONNECTIONS_PER_USER) {
      ws.close(WS_CLOSE_TOO_MANY, 'Too many connections');
      return;
    }

    ws.isAlive = true;
    ws.userId = userId;

    // Add to user's channel
    const userSet = userChannels.get(userId) ?? new Set<WebSocket>();
    if (!userChannels.has(userId)) {
      userChannels.set(userId, userSet);
    }
    userSet.add(ws);

    // Cancel idle timer since user has an active connection
    schedulerRegistry.cancelIdle(userId);

    // Track active connection in Redis
    const redis = getRedisClient();
    if (redis) {
      redis
        .set(`ws:active:${userId}:${INSTANCE_ID}`, '1', 'EX', WS_ACTIVE_TTL_SECONDS)
        .catch(() => {});
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('error', (err) => {
      log.warn({ err, userId }, 'WebSocket error');
    });

    ws.on('close', () => {
      const channels = userChannels.get(userId);
      if (channels) {
        channels.delete(ws);
        if (channels.size === 0) {
          userChannels.delete(userId);

          // Remove active connection key from Redis
          const r = getRedisClient();
          if (r) {
            r.del(`ws:active:${userId}:${INSTANCE_ID}`).catch(() => {});
          }

          // Schedule idle cleanup since user has no more connections
          schedulerRegistry.scheduleIdle(userId);
        }
      }
    });
  });
}

/** Strip prototype pollution keys from an object */
function sanitizeData(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    result[key] = obj[key];
  }
  return result;
}

/** Build a JSON message string from event parameters */
function buildMessage(event: string, reason: string, data?: unknown): string {
  const payload: Record<string, unknown> = {
    type: event,
    reason,
    timestamp: new Date().toISOString(),
  };
  if (data !== undefined && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    Object.assign(payload, sanitizeData(data as Record<string, unknown>));
  } else if (data !== undefined) {
    payload.data = data;
  }
  return JSON.stringify(payload);
}

/** Deliver a message to a user's local WebSocket connections on this instance */
function deliverLocally(userId: string, event: string, reason: string, data?: unknown): void {
  const channels = userChannels.get(userId);
  if (!channels || channels.size === 0) return;

  const message = buildMessage(event, reason, data);

  for (const client of channels) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/** Deliver a message to ALL local WebSocket connections on this instance */
function deliverToAllLocally(event: string, reason: string, data?: unknown): void {
  if (!wss) return;
  const message = buildMessage(event, reason, data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/** Broadcast a message to a specific user's WebSocket connections (cross-instance via Redis) */
export function broadcastToUser(
  userId: string,
  event: string,
  reason: string,
  data?: unknown,
): void {
  const redis = getRedisClient();
  if (redis) {
    const message = JSON.stringify({ userId, event, reason, data });
    redis.publish(WS_BROADCAST_CHANNEL, message).catch((err) => {
      log.warn({ err }, 'Redis publish failed, falling back to local delivery');
      deliverLocally(userId, event, reason, data);
    });
    return;
  }

  // No Redis — deliver locally only
  deliverLocally(userId, event, reason, data);
}

/** Broadcast to ALL connected clients across all instances (used for system-wide messages) */
export function broadcast(event: string, reason: string, data?: unknown): void {
  const redis = getRedisClient();
  if (redis) {
    const message = JSON.stringify({ userId: '__broadcast__', event, reason, data });
    redis.publish(WS_BROADCAST_CHANNEL, message).catch((err) => {
      log.warn({ err }, 'Redis publish failed for broadcast, falling back to local delivery');
      deliverToAllLocally(event, reason, data);
    });
    return;
  }

  // No Redis — deliver locally only
  deliverToAllLocally(event, reason, data);
}

/** Debounced broadcast for schedule_updated — coalesces rapid successive calls per user */
interface PendingBroadcast {
  timer: ReturnType<typeof setTimeout>;
  event: string;
  reason: string;
  data: unknown;
}
const pendingBroadcasts = new Map<string, PendingBroadcast>();

export function debouncedBroadcastToUser(
  userId: string,
  event: string,
  reason: string,
  data?: unknown,
): void {
  if (event !== 'schedule_updated') {
    broadcastToUser(userId, event, reason, data);
    return;
  }

  const existing = pendingBroadcasts.get(userId);
  if (existing) {
    clearTimeout(existing.timer);
    // Accumulate changes arrays if both payloads have them
    if (
      existing.data &&
      typeof existing.data === 'object' &&
      data &&
      typeof data === 'object' &&
      'changes' in (existing.data as Record<string, unknown>) &&
      'changes' in (data as Record<string, unknown>)
    ) {
      const existingChanges = (existing.data as Record<string, unknown>).changes;
      const newChanges = (data as Record<string, unknown>).changes;
      if (Array.isArray(existingChanges) && Array.isArray(newChanges)) {
        (existing.data as Record<string, unknown>).changes = [...existingChanges, ...newChanges];
        data = existing.data;
      }
    }
  }

  const timer = setTimeout(() => {
    pendingBroadcasts.delete(userId);
    broadcastToUser(userId, event, reason, data);
  }, WS_BROADCAST_DEBOUNCE_MS);

  pendingBroadcasts.set(userId, { timer, event, reason, data });
}

/** Check if a user has active WebSocket connections on this instance */
export function hasActiveConnections(userId: string): boolean {
  const channels = userChannels.get(userId);
  return !!channels && channels.size > 0;
}

/** Check if a user has active WebSocket connections on any instance (local first, then Redis) */
export async function hasActiveConnectionsDistributed(userId: string): Promise<boolean> {
  // Fast path: check local connections first
  if (hasActiveConnections(userId)) return true;

  // Check Redis for connections on other instances
  const redis = getRedisClient();
  if (!redis) return false;

  try {
    const keys: string[] = [];
    const stream = redis.scanStream({ match: `ws:active:${userId}:*`, count: 10 });
    for await (const batch of stream) {
      keys.push(...(batch as string[]));
      if (keys.length > 0) break; // Only need to know if any exist
    }
    return keys.length > 0;
  } catch {
    return false;
  }
}

export function closeWebSocket(): Promise<void> {
  // Clear pending broadcast timers
  for (const pending of pendingBroadcasts.values()) {
    clearTimeout(pending.timer);
  }
  pendingBroadcasts.clear();

  // Clear active connection refresh timer
  if (activeConnectionRefreshTimer) {
    clearInterval(activeConnectionRefreshTimer);
    activeConnectionRefreshTimer = null;
  }

  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }
    wss.close(() => resolve());
  });
}
