import { schedulerRegistry } from './scheduler-registry.js';
import { getRescheduleQueue } from './jobs/queues.js';
import { createLogger } from './logger.js';

const log = createLogger('scheduler');

/**
 * Trigger a reschedule for a specific user.
 * Lazily starts the user's scheduler if not already running.
 * If the scheduler is owned by another instance, enqueues via BullMQ.
 * Fire-and-forget -- errors are logged, not thrown.
 */
export function triggerReschedule(reason: string, userId?: string): void {
  if (!userId) return;

  schedulerRegistry
    .getOrCreate(userId)
    .then((scheduler) => {
      return scheduler.triggerReschedule(reason);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('owned by another instance') || msg.includes('Failed to acquire lock')) {
        // Route to BullMQ for the owning instance to pick up
        const queue = getRescheduleQueue();
        if (queue) {
          queue
            .add('reschedule', { userId, reason }, { jobId: `reschedule:${userId}` })
            .catch((qErr) => {
              log.error({ userId, reason, err: qErr }, 'Failed to enqueue reschedule');
            });
          return;
        }
      }
      log.error({ userId, reason, err }, 'Background reschedule failed');
    });
}
