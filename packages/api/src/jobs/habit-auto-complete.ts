import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import { getRedisClient } from '../cache/redis.js';
import { completeHabit } from '../services/habit-completion.js';
import { createLogger } from '../logger.js';

const log = createLogger('habit-auto-complete');

const QUEUE_NAME = 'fluxure-habit-auto-complete';

let queue: Queue | null = null;
let worker: Worker | null = null;

// --- Redis Set helpers for efficient user/habit job lookups ---
// Uses getRedisClient() directly (same pattern as rest of codebase)

async function addToIndex(key: string, jobId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  await client.sadd(key, jobId);
}

async function removeFromIndex(key: string, jobId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  await client.srem(key, jobId);
}

async function getIndexMembers(key: string): Promise<string[]> {
  const client = getRedisClient();
  if (!client) return [];
  return client.smembers(key);
}

async function deleteIndex(key: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  await client.del(key);
}

function userIndexKey(userId: string): string {
  return `auto-complete:user:${userId}`;
}

function habitIndexKey(habitId: string): string {
  return `auto-complete:habit:${habitId}`;
}

// --- Queue lifecycle ---

export function startAutoCompleteQueue(connection: ConnectionOptions): void {
  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: { age: 86_400 }, // 24h
    },
  });

  log.info('Habit auto-complete queue created');
}

export function startAutoCompleteWorker(connection: ConnectionOptions): void {
  worker = new Worker(QUEUE_NAME, handleAutoCompleteJob, {
    connection,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, data: job?.data, err }, 'Auto-complete job failed');
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job?.id }, 'Auto-complete job completed');
  });

  log.info('Habit auto-complete worker started');
}

async function handleAutoCompleteJob(job: Job): Promise<void> {
  const { userId, habitId, scheduledDate } = job.data as {
    userId: string;
    habitId: string;
    scheduledDate: string;
  };

  log.info({ userId, habitId, scheduledDate, jobId: job.id }, 'Auto-completing habit');

  const result = await completeHabit(userId, habitId, scheduledDate);

  if (result) {
    log.info({ userId, habitId, scheduledDate }, 'Habit auto-completed successfully');
  } else {
    log.info({ userId, habitId, scheduledDate }, 'Habit already completed or deleted, skipping');
  }

  // Clean up index entries after job completes
  const jobId = `${habitId}__${scheduledDate}`;
  await removeFromIndex(userIndexKey(userId), jobId).catch(() => {});
  await removeFromIndex(habitIndexKey(habitId), jobId).catch(() => {});
}

// --- Public API ---

/**
 * Register a delayed auto-complete job for a habit occurrence.
 * Always removes any existing job first (BullMQ ignores duplicate delayed job adds).
 */
export async function registerAutoCompleteJob(
  userId: string,
  habitId: string,
  scheduledDate: string,
  endTimeUtcMs: number,
): Promise<void> {
  if (!queue) return;

  const jobId = `${habitId}__${scheduledDate}`;
  const delay = Math.max(0, endTimeUtcMs - Date.now());

  // Always remove first — BullMQ silently ignores add() for existing delayed jobs
  try {
    await queue.remove(jobId);
  } catch {
    // Job may not exist yet — that's fine
  }

  await queue.add('auto-complete', { userId, habitId, scheduledDate }, { jobId, delay });

  // Maintain lookup indices
  await addToIndex(userIndexKey(userId), jobId).catch(() => {});
  await addToIndex(habitIndexKey(habitId), jobId).catch(() => {});

  log.debug({ jobId, delay, userId, habitId, scheduledDate }, 'Auto-complete job registered');
}

/**
 * Cancel a specific auto-complete job.
 */
export async function cancelAutoCompleteJob(
  habitId: string,
  scheduledDate: string,
  userId?: string,
): Promise<void> {
  if (!queue) return;

  const jobId = `${habitId}__${scheduledDate}`;
  try {
    await queue.remove(jobId);
  } catch {
    // Job may have already fired or been removed
  }

  // Clean indices
  if (userId) {
    await removeFromIndex(userIndexKey(userId), jobId).catch(() => {});
  }
  await removeFromIndex(habitIndexKey(habitId), jobId).catch(() => {});
}

/**
 * Cancel all pending auto-complete jobs for a habit.
 * Uses Redis Set index for O(1) lookup instead of scanning all jobs.
 * Pass userId to also clean the user-level index (prevents stale entries).
 */
export async function cancelAllForHabit(habitId: string, userId?: string): Promise<void> {
  if (!queue) return;

  const key = habitIndexKey(habitId);
  const jobIds = await getIndexMembers(key).catch(() => [] as string[]);

  const removals = jobIds.map((jid) => queue!.remove(jid).catch(() => {}));
  await Promise.all(removals);
  await deleteIndex(key).catch(() => {});

  // Also clean user-level index to prevent stale entries
  if (userId) {
    await Promise.all(
      jobIds.map((jid) => removeFromIndex(userIndexKey(userId), jid).catch(() => {})),
    );
  }

  log.debug({ habitId, count: jobIds.length }, 'Cancelled all auto-complete jobs for habit');
}

/**
 * Cancel all pending auto-complete jobs for a user.
 * Uses Redis Set index for O(1) lookup instead of scanning all jobs.
 */
export async function cancelAllForUser(userId: string): Promise<void> {
  if (!queue) return;

  const key = userIndexKey(userId);
  const jobIds = await getIndexMembers(key).catch(() => [] as string[]);

  const removals = jobIds.map((jid) => queue!.remove(jid).catch(() => {}));
  await Promise.all(removals);
  await deleteIndex(key).catch(() => {});

  // Also clean habit-level indices to prevent stale entries
  const habitIds = new Set(jobIds.map((jid) => jid.split('__')[0]));
  await Promise.all([...habitIds].map((hid) => deleteIndex(habitIndexKey(hid)).catch(() => {})));

  log.debug({ userId, count: jobIds.length }, 'Cancelled all auto-complete jobs for user');
}

/**
 * Register auto-complete jobs for all scheduled habit events of a user.
 * Called when the setting is toggled on, or after a reschedule cycle.
 */
export async function registerBulkForUser(
  userId: string,
  events: Array<{ habitId: string; scheduledDate: string; endTimeUtcMs: number }>,
): Promise<void> {
  await Promise.all(
    events.map((ev) =>
      registerAutoCompleteJob(userId, ev.habitId, ev.scheduledDate, ev.endTimeUtcMs),
    ),
  );
}

// --- Graceful shutdown ---

export async function stopAutoComplete(): Promise<void> {
  // Close worker first (drain in-flight jobs), then queue — same pattern as queues.ts
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  log.info('Habit auto-complete queue and worker stopped');
}
