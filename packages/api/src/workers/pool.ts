import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { reschedule } from '@fluxure/engine';
import type {
  ScheduleResult,
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  CalendarEvent,
  BufferConfig,
  UserSettings,
} from '@fluxure/shared';
import { WORKER_POOL_SIZE } from '../config.js';
import { createLogger } from '../logger.js';

/** Shape of the serialized inputs passed across the worker thread boundary. */
interface RescheduleInputs {
  habits: Habit[];
  tasks: Task[];
  meetings: SmartMeeting[];
  focusRules: FocusTimeRule[];
  calendarEvents: CalendarEvent[];
  bufferConfig: BufferConfig;
  userSettings: UserSettings;
  now?: string;
}

const log = createLogger('worker-pool');

const isDev = import.meta.url.endsWith('.ts');

interface PendingTask {
  id: string;
  inputs: unknown;
  resolve: (result: ScheduleResult) => void;
  reject: (err: Error) => void;
}

const TASK_TIMEOUT_MS = 60_000;
const MAX_RESPAWN_ATTEMPTS = 3;
const MAX_QUEUE_DEPTH = parseInt(process.env.WORKER_POOL_MAX_QUEUE || '100', 10);

export class WorkerPool {
  private workers: Worker[] = [];
  private busy: Set<Worker> = new Set();
  private queue: PendingTask[] = [];
  private pendingTasks = new Map<string, PendingTask>();
  private workerToTaskId = new Map<Worker, string>();
  private taskTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private respawnCounts = new Map<Worker, number>();
  private taskIdCounter = 0;
  private workerPath: string | null = null;

  constructor(private size: number) {}

  async init(): Promise<void> {
    if (isDev) {
      log.info('Dev mode — running scheduling inline (no worker threads)');
      return;
    }

    const thisDir = dirname(fileURLToPath(import.meta.url));
    this.workerPath = resolve(thisDir, 'scheduler-worker.js');

    for (let i = 0; i < this.size; i++) {
      this.spawnWorker();
    }

    log.info({ size: this.size }, 'Initialized workers');
  }

  private spawnWorker(): Worker {
    const worker = new Worker(this.workerPath!);

    worker.on('message', (msg: { id: string; result?: ScheduleResult; error?: string }) => {
      const pending = this.pendingTasks.get(msg.id);
      if (!pending) return;
      this.clearTask(msg.id, worker);

      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result!);
      }

      this.processQueue();
    });

    worker.on('error', (err: Error) => {
      log.error({ err }, 'Worker error');
      this.rejectWorkerTask(worker, err);
      this.busy.delete(worker);
      this.processQueue();
    });

    worker.on('exit', (code: number) => {
      // Remove dead worker from pool
      const idx = this.workers.indexOf(worker);
      if (idx !== -1) this.workers.splice(idx, 1);
      this.busy.delete(worker);
      this.rejectWorkerTask(worker, new Error(`Worker exited with code ${code}`));
      this.workerToTaskId.delete(worker);

      if (code !== 0 && this.workerPath) {
        const attempts = this.respawnCounts.get(worker) ?? 0;
        this.respawnCounts.delete(worker);
        if (attempts < MAX_RESPAWN_ATTEMPTS) {
          log.warn({ code, attempt: attempts + 1 }, 'Respawning crashed worker');
          const newWorker = this.spawnWorker();
          this.respawnCounts.set(newWorker, attempts + 1);
          this.processQueue();
        } else {
          log.error({ code }, 'Worker exceeded max respawn attempts, not replacing');
        }
      }
    });

    this.workers.push(worker);
    return worker;
  }

  /** Reject the pending task owned by a worker (if any). */
  private rejectWorkerTask(worker: Worker, err: Error): void {
    const taskId = this.workerToTaskId.get(worker);
    if (!taskId) return;
    const pending = this.pendingTasks.get(taskId);
    if (pending) {
      this.clearTask(taskId, worker);
      pending.reject(err);
    }
  }

  /** Clean up tracking state for a completed/failed task. */
  private clearTask(taskId: string, worker: Worker): void {
    this.pendingTasks.delete(taskId);
    this.busy.delete(worker);
    this.workerToTaskId.delete(worker);
    const timeout = this.taskTimeouts.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.taskTimeouts.delete(taskId);
    }
  }

  run(inputs: unknown): Promise<ScheduleResult> {
    if (isDev) {
      return this.runInline(inputs);
    }

    return new Promise((resolve, reject) => {
      const id = String(++this.taskIdCounter);
      const task: PendingTask = { id, inputs, resolve, reject };

      const idleWorker = this.workers.find((w) => !this.busy.has(w));
      if (idleWorker) {
        this.dispatch(idleWorker, task);
      } else {
        if (this.queue.length >= MAX_QUEUE_DEPTH) {
          reject(new Error('Worker pool queue full'));
          return;
        }
        this.queue.push(task);
      }
    });
  }

  private runInline(inputs: unknown): Promise<ScheduleResult> {
    try {
      // Cast once at the serialization boundary — runtime shape matches RescheduleInputs
      const data = inputs as RescheduleInputs;
      const result = reschedule(
        data.habits,
        data.tasks,
        data.meetings,
        data.focusRules,
        data.calendarEvents,
        data.bufferConfig,
        data.userSettings,
        data.now ? new Date(data.now) : undefined,
      );
      return Promise.resolve(result);
    } catch (err: unknown) {
      return Promise.reject(new Error(err instanceof Error ? err.message : String(err)));
    }
  }

  private dispatch(worker: Worker, task: PendingTask): void {
    this.busy.add(worker);
    this.pendingTasks.set(task.id, task);
    this.workerToTaskId.set(worker, task.id);

    // Safety-net timeout: reject tasks that run too long and terminate the hung worker
    const timeout = setTimeout(() => {
      this.taskTimeouts.delete(task.id);
      const pending = this.pendingTasks.get(task.id);
      if (pending) {
        this.clearTask(task.id, worker);
        pending.reject(new Error(`Worker task timed out after ${TASK_TIMEOUT_MS}ms`));
        // Terminate the hung worker — the exit handler will respawn a fresh one
        worker.terminate();
        this.processQueue();
      }
    }, TASK_TIMEOUT_MS);
    this.taskTimeouts.set(task.id, timeout);

    worker.postMessage({ id: task.id, inputs: task.inputs });
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    const idleWorker = this.workers.find((w) => !this.busy.has(w));
    if (!idleWorker) return;
    const task = this.queue.shift()!;
    this.dispatch(idleWorker, task);
  }

  async terminate(): Promise<void> {
    for (const timeout of this.taskTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.taskTimeouts.clear();
    for (const worker of this.workers) {
      await worker.terminate();
    }
    this.workers = [];
    this.busy.clear();
    // Reject all queued tasks before clearing
    for (const task of this.queue) {
      task.reject(new Error('Worker pool terminated'));
    }
    this.queue = [];
    this.pendingTasks.clear();
    this.workerToTaskId.clear();
    this.respawnCounts.clear();
    log.info('Terminated');
  }
}

let pool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool | null {
  return pool;
}

export async function initWorkerPool(): Promise<void> {
  const size = WORKER_POOL_SIZE;
  pool = new WorkerPool(size);
  await pool.init();
}

export async function closeWorkerPool(): Promise<void> {
  if (pool) {
    await pool.terminate();
    pool = null;
  }
}
