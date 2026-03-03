import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, Job } from 'bullmq';
import type { ExportCategory } from './data-export.js';
import { getRedisClient } from '../cache/redis.js';
import { createLogger } from '../logger.js';

const log = createLogger('queues');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Queue names
const MAINTENANCE_QUEUE = 'fluxure-maintenance';
const DATA_EXPORT_QUEUE = 'fluxure-data-export';
const RESCHEDULE_QUEUE = 'fluxure-reschedule';

// Module state — queues and workers created lazily in start functions
let maintenanceQueue: Queue | null = null;
let dataExportQueue: Queue | null = null;
let rescheduleQueue: Queue | null = null;

let maintenanceWorker: Worker | null = null;
let dataExportWorker: Worker | null = null;
let rescheduleWorker: Worker | null = null;

// --- Status ---

/** Returns true when BullMQ queues have been successfully created (Redis available). */
export function isQueuesStarted(): boolean {
  return maintenanceQueue !== null;
}

// --- Getters ---

export function getMaintenanceQueue(): Queue | null {
  return maintenanceQueue;
}

export function getDataExportQueue(): Queue | null {
  return dataExportQueue;
}

export function getRescheduleQueue(): Queue | null {
  return rescheduleQueue;
}

// --- Connection helper ---

function getConnection(): ConnectionOptions | null {
  const client = getRedisClient();
  if (!client) return null;

  const opts = client.options;
  return {
    host: opts.host ?? '127.0.0.1',
    port: opts.port ?? 6379,
    password: opts.password ?? undefined,
    db: opts.db ?? 0,
  };
}

// --- Queue lifecycle ---

export async function startQueues(): Promise<boolean> {
  const connection = getConnection();
  if (!connection) {
    log.warn('Redis not available, skipping BullMQ queue creation');
    return false;
  }

  const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnFail: { count: 1000 },
  };

  maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection, defaultJobOptions });
  dataExportQueue = new Queue(DATA_EXPORT_QUEUE, { connection, defaultJobOptions });
  rescheduleQueue = new Queue(RESCHEDULE_QUEUE, { connection, defaultJobOptions });

  // Register repeatable maintenance jobs via upsertJobScheduler
  await maintenanceQueue.upsertJobScheduler('cleanup:activity-log', {
    every: 6 * 60 * 60 * 1000, // 6 hours
  });

  await maintenanceQueue.upsertJobScheduler('cleanup:password-resets', {
    every: 6 * 60 * 60 * 1000,
  });

  await maintenanceQueue.upsertJobScheduler('cleanup:schedule-data', {
    every: 24 * 60 * 60 * 1000, // daily
  });

  await maintenanceQueue.upsertJobScheduler('cleanup:oauth-states', {
    every: 60 * 60 * 1000, // hourly
  });

  await maintenanceQueue.upsertJobScheduler('cleanup:expired-sessions', {
    every: 6 * 60 * 60 * 1000, // 6 hours
  });

  await maintenanceQueue.upsertJobScheduler('cleanup:schedule-changes', {
    every: 24 * 60 * 60 * 1000, // daily
  });

  await maintenanceQueue.upsertJobScheduler('cleanup:email-verifications', {
    every: 6 * 60 * 60 * 1000, // 6 hours
  });

  log.info('BullMQ queues created and repeatable jobs registered');
  return true;
}

// --- Worker lifecycle ---

async function handleMaintenanceJob(job: Job): Promise<void> {
  const jobName = job.name;
  log.info({ jobName }, 'Running maintenance job');

  switch (jobName) {
    case 'cleanup:activity-log': {
      const { cleanupActivityLog } = await import('../data-retention.js');
      const deleted = await cleanupActivityLog();
      log.info({ deleted }, 'Activity log cleanup complete');
      break;
    }
    case 'cleanup:password-resets': {
      const { cleanupPasswordResets } = await import('../data-retention.js');
      const deleted = await cleanupPasswordResets();
      log.info({ deleted }, 'Password resets cleanup complete');
      break;
    }
    case 'cleanup:schedule-data': {
      const { cleanupScheduleData } = await import('../scheduler-registry.js');
      await cleanupScheduleData();
      log.info('Schedule data cleanup complete');
      break;
    }
    case 'cleanup:oauth-states': {
      const { cleanupOauthStates } = await import('../routes/auth.js');
      await cleanupOauthStates();
      log.info('OAuth states cleanup complete');
      break;
    }
    case 'cleanup:expired-sessions': {
      const { cleanupExpiredSessions } = await import('../data-retention.js');
      const deleted = await cleanupExpiredSessions();
      log.info({ deleted }, 'Expired sessions cleanup complete');
      break;
    }
    case 'cleanup:schedule-changes': {
      const { cleanupScheduleChanges } = await import('../data-retention.js');
      const deleted = await cleanupScheduleChanges();
      log.info({ deleted }, 'Schedule changes cleanup complete');
      break;
    }
    case 'cleanup:email-verifications': {
      const { cleanupExpiredVerifications } = await import('../data-retention.js');
      const deleted = await cleanupExpiredVerifications();
      log.info({ deleted }, 'Email verifications cleanup complete');
      break;
    }
    default:
      log.warn({ jobName }, 'Unknown maintenance job');
  }
}

async function handleRescheduleJob(job: Job): Promise<void> {
  const { userId, reason } = job.data as { userId: string; reason: string };
  if (!UUID_RE.test(userId)) {
    throw new Error('Invalid userId in job data');
  }
  log.info({ userId, jobId: job.id, reason }, 'Processing reschedule job');

  const { isOwner, claimUser } = await import('../distributed/scheduler-owner.js');

  // If we own this user, execute locally
  if (await isOwner(userId)) {
    const { schedulerRegistry } = await import('../scheduler-registry.js');
    const scheduler = await schedulerRegistry.getOrCreate(userId);
    await scheduler.triggerReschedule(reason);
    return;
  }

  // Try to claim if unowned
  const claimed = await claimUser(userId);
  if (claimed) {
    const { schedulerRegistry } = await import('../scheduler-registry.js');
    const scheduler = await schedulerRegistry.getOrCreate(userId);
    await scheduler.triggerReschedule(reason);
    return;
  }

  // Owned by another instance — delay and retry
  await job.moveToDelayed(Date.now() + 2000);
}

async function handleDataExportJob(job: Job): Promise<void> {
  const { userId, categories } = job.data as {
    userId: string;
    categories: readonly ExportCategory[];
  };
  if (!UUID_RE.test(userId)) {
    throw new Error('Invalid userId in job data');
  }
  log.info({ userId, jobId: job.id }, 'Processing data export job');

  const { processDataExport } = await import('./data-export.js');
  await processDataExport(userId, categories);
}

export function startWorkers(): boolean {
  const connection = getConnection();
  if (!connection) {
    log.warn('Redis not available, skipping BullMQ worker creation');
    return false;
  }

  maintenanceWorker = new Worker(MAINTENANCE_QUEUE, handleMaintenanceJob, {
    connection,
    concurrency: 1,
  });

  maintenanceWorker.on('failed', (job, err) => {
    log.error({ jobName: job?.name, err }, 'Maintenance job failed');
  });

  dataExportWorker = new Worker(DATA_EXPORT_QUEUE, handleDataExportJob, {
    connection,
    concurrency: 2,
  });

  dataExportWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Data export job failed');
  });

  rescheduleWorker = new Worker(RESCHEDULE_QUEUE, handleRescheduleJob, {
    connection,
    concurrency: 10,
  });

  rescheduleWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, jobData: job?.data, err }, 'Reschedule job failed');
  });

  log.info('BullMQ workers started');
  return true;
}

// --- Graceful shutdown ---

export async function stopQueues(): Promise<void> {
  const closeOps: Promise<void>[] = [];

  // Close workers first
  if (maintenanceWorker) {
    closeOps.push(maintenanceWorker.close());
    maintenanceWorker = null;
  }
  if (dataExportWorker) {
    closeOps.push(dataExportWorker.close());
    dataExportWorker = null;
  }
  if (rescheduleWorker) {
    closeOps.push(rescheduleWorker.close());
    rescheduleWorker = null;
  }

  if (closeOps.length > 0) {
    await Promise.all(closeOps);
  }

  // Then close queues
  const queueCloseOps: Promise<void>[] = [];

  if (maintenanceQueue) {
    queueCloseOps.push(maintenanceQueue.close());
    maintenanceQueue = null;
  }
  if (dataExportQueue) {
    queueCloseOps.push(dataExportQueue.close());
    dataExportQueue = null;
  }
  if (rescheduleQueue) {
    queueCloseOps.push(rescheduleQueue.close());
    rescheduleQueue = null;
  }

  if (queueCloseOps.length > 0) {
    await Promise.all(queueCloseOps);
  }

  log.info('BullMQ queues and workers stopped');
}
