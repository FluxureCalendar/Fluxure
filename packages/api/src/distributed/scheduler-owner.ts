import { getRedisClient } from '../cache/redis.js';
import { INSTANCE_ID } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('scheduler-owner');

const OWNERSHIP_TTL_S = 60;
const REFRESH_INTERVAL_MS = 20_000;

/** Lua script: atomic release — only delete if we own the key. */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/** Users owned by this instance. */
const ownedUsers = new Set<string>();

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function ownershipKey(userId: string): string {
  return `owner:scheduler:${userId}`;
}

/**
 * Claim ownership of a user's scheduler.
 * Returns true if claimed (or already owned), false if owned by another instance.
 * No-Redis fallback: always returns true (single-instance mode).
 */
export async function claimUser(userId: string): Promise<boolean> {
  const redis = getRedisClient();

  if (!redis) {
    ownedUsers.add(userId);
    return true;
  }

  const result = await redis.set(ownershipKey(userId), INSTANCE_ID, 'EX', OWNERSHIP_TTL_S, 'NX');
  if (result === 'OK') {
    ownedUsers.add(userId);
    return true;
  }

  // Check if we already own it (re-entrant claim)
  const currentOwner = await redis.get(ownershipKey(userId));
  if (currentOwner === INSTANCE_ID) {
    ownedUsers.add(userId);
    return true;
  }

  return false;
}

/**
 * Release ownership of a user's scheduler.
 * Uses Lua script for atomic check-and-delete.
 */
export async function releaseUser(userId: string): Promise<void> {
  ownedUsers.delete(userId);
  const redis = getRedisClient();
  if (!redis) return;

  try {
    // ioredis .eval() runs a Lua script on the Redis server (not JS eval)
    await redis.eval(RELEASE_SCRIPT, 1, ownershipKey(userId), INSTANCE_ID);
  } catch (err) {
    log.warn({ err, userId }, 'Failed to release ownership');
  }
}

/**
 * Check if this instance owns the scheduler for a user.
 * No-Redis fallback: always returns true.
 */
export async function isOwner(userId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;

  const owner = await redis.get(ownershipKey(userId));
  return owner === INSTANCE_ID;
}

/**
 * Start the ownership refresh loop.
 * Refreshes TTL on all owned keys every 20s using a pipeline.
 */
export function startRefreshLoop(): void {
  if (refreshTimer) return;

  refreshTimer = setInterval(async () => {
    const redis = getRedisClient();
    if (!redis || ownedUsers.size === 0) return;

    try {
      const pipeline = redis.pipeline();
      for (const userId of ownedUsers) {
        pipeline.expire(ownershipKey(userId), OWNERSHIP_TTL_S);
      }
      await pipeline.exec();
    } catch (err) {
      log.warn({ err }, 'Ownership refresh failed');
    }
  }, REFRESH_INTERVAL_MS);
}

/**
 * Stop the refresh loop and release all owned users.
 */
export async function stopRefreshLoop(): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  const redis = getRedisClient();
  if (!redis || ownedUsers.size === 0) {
    ownedUsers.clear();
    return;
  }

  try {
    const pipeline = redis.pipeline();
    for (const userId of ownedUsers) {
      pipeline.eval(RELEASE_SCRIPT, 1, ownershipKey(userId), INSTANCE_ID);
    }
    await pipeline.exec();
  } catch (err) {
    log.warn({ err }, 'Failed to release all owned users during shutdown');
  }

  ownedUsers.clear();
}

/**
 * Get the set of users owned by this instance (read-only view).
 */
export function getOwnedUsers(): ReadonlySet<string> {
  return ownedUsers;
}
