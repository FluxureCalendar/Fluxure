import { eq, and, isNotNull, inArray, lt, gte, lte, sql } from 'drizzle-orm';
import { db } from './db/pg-index.js';
import {
  users,
  habits,
  tasks,
  smartMeetings,
  focusTimeRules,
  bufferConfig,
  calendars,
  calendarEvents,
  scheduledEvents,
  scheduleChanges,
  activityLog,
} from './db/pg-schema.js';
import {
  createOAuth2Client,
  setCredentials,
  GoogleCalendarClient,
  CalendarPollerManager,
} from './google/index.js';
import type { OAuth2Client } from './google/index.js';
import { decrypt } from './crypto.js';
import { reschedule } from '@fluxure/engine';
import type {
  BufferConfig as BufferConfigType,
  CalendarEvent,
  CalendarOperation,
  UserSettings,
} from '@fluxure/shared';
import {
  DecompressionTarget,
  EventStatus,
  ItemType,
  CalendarOpType,
  EXTENDED_PROPS,
  SCHEDULE_LOOKBACK_MS,
  MIN_SCHEDULE_CHANGE_MS,
  SCHEDULER_BOOT_CONCURRENCY,
  DEFAULT_BUFFER_CONFIG,
  DEFAULT_WORKING_HOURS,
  DEFAULT_PERSONAL_HOURS,
  DEFAULT_TIMEZONE,
  DEFAULT_SCHEDULING_WINDOW_DAYS,
  DEFAULT_PAST_EVENT_RETENTION_DAYS,
  MS_PER_DAY,
  getPlanLimits,
} from '@fluxure/shared';
import { recordScheduleChanges } from './routes/schedule.js';
import { broadcastToUser, debouncedBroadcastToUser } from './ws.js';
import { IDLE_TIMEOUT_MS, SCHEDULE_CHANGES_RETENTION_DAYS } from './config.js';
import { getWorkerPool } from './workers/pool.js';
import { cacheHashDelAll } from './cache/redis.js';
import { toHabit, toTask, toMeeting, toFocusRule, toBufConfig } from './utils/converters.js';
import { createLogger } from './logger.js';
import { withDistributedLock } from './distributed/lock.js';
import {
  claimUser,
  releaseUser,
  startRefreshLoop,
  stopRefreshLoop,
} from './distributed/scheduler-owner.js';
import { isQueuesStarted } from './jobs/queues.js';

const log = createLogger('scheduler');

/** Build a map of existing managed events for change tracking. */
function buildExistingEventsMap(
  existingEvents: CalendarEvent[],
): Map<string, { start: string; end: string; title: string; itemType: string; itemId: string }> {
  const map = new Map<
    string,
    { start: string; end: string; title: string; itemType: string; itemId: string }
  >();
  for (const ev of existingEvents) {
    if (ev.isManaged) {
      map.set(ev.id, {
        start: ev.start,
        end: ev.end,
        title: ev.title || '',
        itemType: ev.itemType || '',
        itemId: ev.itemId || '',
      });
    }
  }
  return map;
}

// ============================================================
// UserScheduler — per-user scheduling lifecycle
// ============================================================

export class UserScheduler {
  readonly userId: string;
  private oauth2Client: OAuth2Client;
  private calClient: GoogleCalendarClient;
  private pollerManager: CalendarPollerManager | null = null;
  private pendingReschedule: { reason: string } | null = null;
  private started = false;
  private lastRescheduleAt = 0;

  get isRunning(): boolean {
    return this.started;
  }
  private operationLock: Promise<void> = Promise.resolve();

  // Cached settings (loaded on start, refreshable)
  private cachedUserSettings: UserSettings | null = null;
  private cachedBufferConfig: BufferConfigType | null = null;
  private cachedCalIdToGoogleCalId: Map<string, string> = new Map();
  private hasWritableCalendar = false;

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    // Local chain is the outer lock (instant queuing), distributed lock acquired inside
    // to avoid TTL being consumed while waiting for the local chain
    return new Promise<T>((resolve, reject) => {
      this.operationLock = this.operationLock.then(async () => {
        try {
          const result = await withDistributedLock(`lock:reschedule:${this.userId}`, 300_000, fn);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  constructor(userId: string, oauth2Client: OAuth2Client) {
    this.userId = userId;
    this.oauth2Client = oauth2Client;
    this.calClient = new GoogleCalendarClient(oauth2Client);
  }

  getCalClient(): GoogleCalendarClient {
    return this.calClient;
  }

  getPollerManager(): CalendarPollerManager | null {
    return this.pollerManager;
  }

  /** Refresh cached user settings and buffer config from DB. */
  async refreshSettings(): Promise<void> {
    const [currentUserRows, bufRows, enabledCals] = await Promise.all([
      db.select().from(users).where(eq(users.id, this.userId)),
      db.select().from(bufferConfig).where(eq(bufferConfig.userId, this.userId)),
      db.select().from(calendars).where(eq(calendars.userId, this.userId)),
    ]);

    const userRow = currentUserRows[0];
    const settingsRaw = userRow?.settings;
    const parsed: UserSettings =
      settingsRaw && typeof settingsRaw === 'object'
        ? (settingsRaw as UserSettings)
        : {
            workingHours: DEFAULT_WORKING_HOURS,
            personalHours: DEFAULT_PERSONAL_HOURS,
            timezone: DEFAULT_TIMEZONE,
            schedulingWindowDays: DEFAULT_SCHEDULING_WINDOW_DAYS,
          };

    // Clamp scheduling window to plan limit
    const limits = getPlanLimits(userRow?.plan ?? 'free');
    this.cachedUserSettings = {
      ...parsed,
      schedulingWindowDays: Math.min(
        parsed.schedulingWindowDays ?? DEFAULT_SCHEDULING_WINDOW_DAYS,
        limits.schedulingWindowDays,
      ),
    };

    this.cachedBufferConfig =
      bufRows.length > 0
        ? toBufConfig(bufRows[0])
        : {
            id: 'default',
            ...DEFAULT_BUFFER_CONFIG,
            applyDecompressionTo: DecompressionTarget.All,
          };

    this.cachedCalIdToGoogleCalId = new Map(enabledCals.map((c) => [c.id, c.googleCalendarId]));
    this.hasWritableCalendar = enabledCals.some(
      (c) => c.enabled && (c.mode === 'writable' || c.isPrimary),
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.refreshSettings();

    const manager = new CalendarPollerManager(
      this.calClient,
      async (calendarId, polledEvents) => {
        await this.handlePolledEvents(calendarId, polledEvents, manager);
      },
      this.userId,
      async () => {
        log.error({ userId: this.userId }, 'Google auth revoked, clearing token');
        await db.update(users).set({ googleRefreshToken: null }).where(eq(users.id, this.userId));
        await this.stop();
        broadcastToUser(
          this.userId,
          'google_auth_required',
          'Google Calendar access has been revoked. Please reconnect.',
        );
      },
      process.env.WEBHOOK_BASE_URL,
    );

    this.pollerManager = manager;

    await manager.startAll();
    log.info({ userId: this.userId }, 'Polling started');

    try {
      await this.triggerReschedule('Startup sync');
    } catch (err) {
      log.error({ userId: this.userId, err }, 'Startup reschedule failed');
    }
  }

  async stop(): Promise<void> {
    if (this.pollerManager) {
      await this.pollerManager.stopAll();
      this.pollerManager = null;
    }
    this.started = false;
    log.info({ userId: this.userId }, 'Stopped');
  }

  /** Handle a push notification for a specific calendar. */
  async handleWebhookNotification(calendarId: string): Promise<void> {
    if (!this.pollerManager) return;

    const handled = this.pollerManager.handleWebhookNotification(calendarId);
    if (!handled) {
      // Self-healing: poller was missing — restart it and reschedule
      log.warn({ userId: this.userId, calendarId }, 'Recovering missing poller for calendar');
      try {
        await this.pollerManager.restartPoller(calendarId);
        await this.triggerReschedule('Webhook recovery — calendar poller restarted');
      } catch (err) {
        log.error({ userId: this.userId, calendarId, err }, 'Poller recovery failed');
      }
    }
  }

  async triggerReschedule(reason: string): Promise<number> {
    return this.withLock(async () => {
      let result: number;
      try {
        result = await this.doRescheduleAndApply(reason);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown scheduling error';
        log.error({ err, userId: this.userId }, 'Reschedule failed');
        broadcastToUser(this.userId, 'system_message', 'Reschedule failed', {
          level: 'error',
          message: `Scheduling error: ${message.slice(0, 100)}. Will retry automatically.`,
        });
        throw err;
      }
      this.lastRescheduleAt = Date.now();

      // Drain any queued reschedule that arrived while we held the lock
      if (this.pendingReschedule) {
        const next = this.pendingReschedule;
        this.pendingReschedule = null;
        // Run inside the same lock chain to preserve serialization
        try {
          await this.doRescheduleAndApply(next.reason);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown scheduling error';
          log.error({ userId: this.userId, err }, 'Queued reschedule failed');
          broadcastToUser(this.userId, 'system_message', 'Queued reschedule failed', {
            level: 'error',
            message: `Scheduling error: ${message.slice(0, 100)}. Will retry automatically.`,
          });
        }
      }

      return result;
    });
  }

  private async doRescheduleAndApply(reason: string): Promise<number> {
    const userId = this.userId;
    const calClient = this.calClient;
    const manager = this.pollerManager;

    // Force-sync all calendars to ensure fresh data before rescheduling
    if (manager) {
      await manager.syncAllNow();
    }

    if (!this.cachedUserSettings || !this.cachedBufferConfig) {
      await this.refreshSettings();
    }
    if (!this.cachedUserSettings || !this.cachedBufferConfig) {
      log.error({ userId }, 'Cannot reschedule: user settings unavailable');
      return 0;
    }
    const userSettings = this.cachedUserSettings;
    const buf = this.cachedBufferConfig;

    if (!this.hasWritableCalendar) {
      broadcastToUser(userId, 'system_message', 'No writable calendar enabled', {
        level: 'warning',
        message: 'No writable calendar enabled. Connect a calendar in Settings to schedule items.',
      });
      return 0;
    }

    const { allHabits, allTasks, allMeetings, allFocusRules } = await this.loadDomainObjects();

    const validItemIds = new Set([
      ...allHabits.map((h) => h.id),
      ...allTasks.map((t) => t.id),
      ...allMeetings.map((m) => m.id),
      ...allFocusRules.map((f) => f.id),
    ]);

    const existingEvents = await this.loadAndCleanScheduledEvents(validItemIds);
    await this.mergeExternalEvents(existingEvents);

    const defaultHabitCalId = userSettings.defaultHabitCalendarId || null;
    const defaultTaskCalId = userSettings.defaultTaskCalendarId || null;

    const result = await this.runSchedulingEngine(
      allHabits,
      allTasks,
      allMeetings,
      allFocusRules,
      existingEvents,
      buf,
      userSettings,
    );

    result.operations = this.filterTrivialUpdates(result.operations, existingEvents);
    if (result.operations.length === 0) return 0;

    const existingEventsMap = buildExistingEventsMap(existingEvents);
    this.tagOperations(result.operations, allHabits, defaultHabitCalId, defaultTaskCalId);

    const calIdToGoogleCalId = this.cachedCalIdToGoogleCalId;
    result.operations = await this.applyToGoogleCalendar(
      result.operations,
      calClient,
      calIdToGoogleCalId,
    );
    if (result.operations.length === 0) return 0;

    await this.persistOperations(result.operations, calClient, calIdToGoogleCalId);

    // Record changes after successful DB persist to avoid logging ops that failed
    const changes = await recordScheduleChanges(result.operations, existingEventsMap, userId);

    if (manager) manager.markAllWritten();
    for (const op of result.operations) {
      log.info(
        {
          userId,
          opType: op.type,
          itemType: op.itemType,
          title: op.title,
          start: op.start,
          end: op.end,
        },
        'Operation applied',
      );
    }
    log.info({ userId, reason, opCount: result.operations.length }, 'Reschedule completed');
    // Invalidate quality cache on reschedule
    cacheHashDelAll(`quality:${userId}`).catch((err) => {
      log.warn({ err, userId }, 'Failed to invalidate quality cache after reschedule');
    });

    if (result.operations.length > 0) {
      const batchId = changes.length > 0 ? changes[0].batchId : '';
      debouncedBroadcastToUser(userId, 'schedule_updated', reason, {
        changes,
        batchId,
        changeCount: changes.length,
      });
    }
    return result.operations.length;
  }

  /** Load all domain objects for the user. */
  private async loadDomainObjects() {
    const userId = this.userId;
    const [allHabitsRaw, allTasksRaw, allMeetingsRaw, allFocusRulesRaw] = await Promise.all([
      db
        .select()
        .from(habits)
        .where(and(eq(habits.userId, userId), eq(habits.enabled, true))),
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.enabled, true))),
      db
        .select()
        .from(smartMeetings)
        .where(and(eq(smartMeetings.userId, userId), eq(smartMeetings.enabled, true))),
      db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId)),
    ]);
    return {
      allHabits: allHabitsRaw.map(toHabit),
      allTasks: allTasksRaw.map(toTask),
      allMeetings: allMeetingsRaw.map(toMeeting),
      allFocusRules: allFocusRulesRaw.map(toFocusRule),
    };
  }

  /** Load managed events, remove orphans and duplicates. */
  private async loadAndCleanScheduledEvents(validItemIds: Set<string>): Promise<CalendarEvent[]> {
    const userId = this.userId;
    const todayCutoff = new Date(Date.now() - SCHEDULE_LOOKBACK_MS).toISOString();
    const rawRows = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.userId, userId), gte(scheduledEvents.end, todayCutoff)));

    // Keep orphaned events (parent item deleted) in the list so the engine
    // generates Delete ops for Google Calendar cleanup. The DB rows will be
    // removed by persistOperations after the Google events are deleted.
    const orphanCount = rawRows.filter((r) => {
      if (!r.itemId) return false;
      const originalId = r.itemId.split('__')[0];
      return !validItemIds.has(originalId);
    }).length;
    if (orphanCount > 0) {
      log.info(
        { userId, orphanCount },
        'Found orphaned scheduled events — will clean up via reschedule',
      );
    }

    const futureRows = rawRows.filter((r) => r.end && r.end >= todayCutoff);

    // Deduplicate by itemId
    const dedupedRows = await this.deduplicateRows(futureRows);

    return dedupedRows.map((row) => ({
      id: row.id,
      googleEventId: row.googleEventId || '',
      title: row.title || '',
      start: row.start || '',
      end: row.end || '',
      isManaged: true,
      itemType: row.itemType as ItemType,
      itemId: row.itemId,
      status: (row.status || 'free') as EventStatus,
      calendarId: row.calendarId || 'primary',
    }));
  }

  /** Deduplicate scheduled event rows by itemId, keeping rows with googleEventId. */
  private async deduplicateRows<
    T extends { id: string; itemId: string | null; googleEventId: string | null },
  >(futureRows: T[]): Promise<T[]> {
    const byItemId = new Map<string, T[]>();
    for (const row of futureRows) {
      const key = row.itemId || row.id;
      const group = byItemId.get(key) || [];
      group.push(row);
      byItemId.set(key, group);
    }

    const dedupedRows: T[] = [];
    const dedupDeleteIds: string[] = [];
    for (const [, group] of byItemId) {
      if (group.length === 1) {
        dedupedRows.push(group[0]);
        continue;
      }
      group.sort((a, b) => {
        if (a.googleEventId && !b.googleEventId) return -1;
        if (!a.googleEventId && b.googleEventId) return 1;
        return 0;
      });
      dedupedRows.push(group[0]);
      for (let i = 1; i < group.length; i++) {
        dedupDeleteIds.push(group[i].id);
      }
    }
    if (dedupDeleteIds.length > 0) {
      await db
        .delete(scheduledEvents)
        .where(
          and(inArray(scheduledEvents.id, dedupDeleteIds), eq(scheduledEvents.userId, this.userId)),
        );
    }
    return dedupedRows;
  }

  /** Merge cached external calendar events into the existingEvents array. */
  private async mergeExternalEvents(existingEvents: CalendarEvent[]): Promise<void> {
    const userId = this.userId;
    const todayCutoff = new Date(Date.now() - SCHEDULE_LOOKBACK_MS).toISOString();
    // Only fetch events within the scheduling horizon plus a 7-day buffer
    const windowDays =
      this.cachedUserSettings?.schedulingWindowDays ?? DEFAULT_SCHEDULING_WINDOW_DAYS;
    const futureCutoff = new Date(
      Date.now() + (windowDays + 7) * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [allCachedExternal, enabledCals] = await Promise.all([
      db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, userId),
            gte(calendarEvents.end, todayCutoff),
            lte(calendarEvents.start, futureCutoff),
          ),
        ),
      db.select().from(calendars).where(eq(calendars.userId, userId)),
    ]);
    const enabledCalsList = enabledCals.filter((c) => c.enabled);

    this.cachedCalIdToGoogleCalId = new Map(enabledCals.map((c) => [c.id, c.googleCalendarId]));
    const calModeMap = new Map(enabledCalsList.map((c) => [c.id, c.mode]));

    for (const row of allCachedExternal) {
      if (!row.start || !row.end) continue;
      const evEnd = new Date(row.end).getTime();
      if (isNaN(evEnd) || evEnd < Date.now()) continue;
      const mode = calModeMap.get(row.calendarId);
      if (!mode) continue;

      existingEvents.push({
        id: row.id,
        googleEventId: row.googleEventId || '',
        title: row.title || '',
        start: row.start,
        end: row.end,
        isManaged: false,
        itemType: null,
        itemId: null,
        status: mode === 'locked' ? EventStatus.Locked : EventStatus.Busy,
        calendarId: row.calendarId,
      });
    }
  }

  /** Run the scheduling engine, offloading to worker thread if available. */
  private async runSchedulingEngine(
    allHabits: ReturnType<typeof toHabit>[],
    allTasks: ReturnType<typeof toTask>[],
    allMeetings: ReturnType<typeof toMeeting>[],
    allFocusRules: ReturnType<typeof toFocusRule>[],
    existingEvents: CalendarEvent[],
    buf: BufferConfigType,
    userSettings: UserSettings,
  ): Promise<{ operations: CalendarOperation[]; unschedulable: unknown[] }> {
    const workerPool = getWorkerPool();
    if (workerPool) {
      try {
        return await workerPool.run({
          habits: allHabits,
          tasks: allTasks,
          meetings: allMeetings,
          focusRules: allFocusRules,
          calendarEvents: existingEvents,
          bufferConfig: buf,
          userSettings,
        });
      } catch (err) {
        log.warn({ userId: this.userId, err }, 'Worker failed, falling back to main thread');
      }
    }
    return reschedule(
      allHabits,
      allTasks,
      allMeetings,
      allFocusRules,
      existingEvents,
      buf,
      userSettings,
    );
  }

  /** Filter out trivial updates (sub-threshold time changes). */
  private filterTrivialUpdates(
    operations: CalendarOperation[],
    existingEvents: CalendarEvent[],
  ): CalendarOperation[] {
    const existingMap = new Map(existingEvents.map((e) => [e.id, e]));
    return operations.filter((op) => {
      if (op.type !== CalendarOpType.Update || !op.eventId) return true;
      const existing = existingMap.get(op.eventId);
      if (!existing) return true;
      const startDiff = Math.abs(new Date(op.start).getTime() - new Date(existing.start).getTime());
      const endDiff = Math.abs(new Date(op.end).getTime() - new Date(existing.end).getTime());
      return startDiff >= MIN_SCHEDULE_CHANGE_MS || endDiff >= MIN_SCHEDULE_CHANGE_MS;
    });
  }

  /** Tag operations with calendarId and habit notification preferences. */
  private tagOperations(
    operations: CalendarOperation[],
    allHabits: ReturnType<typeof toHabit>[],
    defaultHabitCalId: string | null,
    defaultTaskCalId: string | null,
  ): void {
    const habitNotificationsMap = new Map<string, boolean>();
    for (const h of allHabits) {
      habitNotificationsMap.set(h.id, h.notifications);
    }

    for (const op of operations) {
      if (!op.calendarId) {
        if (op.itemType === ItemType.Habit || op.itemType === ItemType.Focus) {
          op.calendarId = defaultHabitCalId ?? undefined;
        } else if (op.itemType === ItemType.Task) {
          op.calendarId = defaultTaskCalId ?? undefined;
        } else {
          op.calendarId = 'primary';
        }
      }

      if (op.itemType === ItemType.Habit) {
        const originalItemId = op.itemId.split('__')[0];
        op.useDefaultReminders = habitNotificationsMap.get(originalItemId) ?? false;
      }
    }
  }

  /** Apply operations to Google Calendar, removing failed ops. */
  private async applyToGoogleCalendar(
    operations: CalendarOperation[],
    calClient: GoogleCalendarClient,
    calIdToGoogleCalId: Map<string, string>,
  ): Promise<CalendarOperation[]> {
    const opsByGoogleCal = new Map<string, CalendarOperation[]>();
    for (const op of operations) {
      const isUuid = op.calendarId && op.calendarId !== 'primary';
      const googleCalId = isUuid ? calIdToGoogleCalId.get(op.calendarId!) || 'primary' : 'primary';
      const existingOps = opsByGoogleCal.get(googleCalId) || [];
      existingOps.push(op);
      opsByGoogleCal.set(googleCalId, existingOps);
    }

    // applyOperations now returns failed ops on 429/503
    const failedOps: CalendarOperation[] = [];
    for (const [googleCalId, ops] of opsByGoogleCal) {
      const failed = await calClient.applyOperations(googleCalId, ops);
      failedOps.push(...failed);
    }

    if (failedOps.length > 0) {
      const failedSet = new Set(failedOps);
      return operations.filter((op) => !failedSet.has(op));
    }
    return operations;
  }

  /** Persist operations to DB in a transaction, then delete orphaned Google events. */
  private async persistOperations(
    operations: CalendarOperation[],
    calClient: GoogleCalendarClient,
    calIdToGoogleCalId: Map<string, string>,
  ): Promise<void> {
    const userId = this.userId;
    const nowTs = new Date().toISOString();
    const orphanedGoogleEventIds: { googleEventId: string; calendarId: string }[] = [];

    // Pre-fetch existing events for Create ops to detect upserts and orphaned Google events
    const createItemIds = operations
      .filter((op) => op.type === CalendarOpType.Create)
      .map((op) => op.itemId);
    const existingByItemId = new Map<
      string,
      { id: string; googleEventId: string | null; calendarId: string | null }
    >();
    if (createItemIds.length > 0) {
      const existingRows = await db
        .select({
          id: scheduledEvents.id,
          itemId: scheduledEvents.itemId,
          googleEventId: scheduledEvents.googleEventId,
          calendarId: scheduledEvents.calendarId,
        })
        .from(scheduledEvents)
        .where(
          and(inArray(scheduledEvents.itemId, createItemIds), eq(scheduledEvents.userId, userId)),
        );
      for (const row of existingRows) {
        if (row.itemId) {
          existingByItemId.set(row.itemId, {
            id: row.id,
            googleEventId: row.googleEventId,
            calendarId: row.calendarId,
          });
        }
      }
    }

    const insertValues: Array<{
      userId: string;
      itemType: string;
      itemId: string;
      title: string;
      googleEventId: string | null;
      calendarId: string;
      start: string;
      end: string;
      status: string;
      alternativeSlotsCount: null;
      createdAt: string;
      updatedAt: string;
    }> = [];
    const upsertUpdates: Array<{ existing: { id: string }; op: (typeof operations)[number] }> = [];
    const updateOps: Array<(typeof operations)[number]> = [];
    const deleteIds: string[] = [];

    for (const op of operations) {
      if (op.type === CalendarOpType.Create) {
        const existing = existingByItemId.get(op.itemId);
        if (existing) {
          if (existing.googleEventId && existing.googleEventId !== (op.googleEventId || null)) {
            orphanedGoogleEventIds.push({
              googleEventId: existing.googleEventId,
              calendarId: existing.calendarId || 'primary',
            });
          }
          upsertUpdates.push({ existing, op });
        } else {
          insertValues.push({
            userId,
            itemType: op.itemType,
            itemId: op.itemId,
            title: op.title,
            googleEventId: op.googleEventId || null,
            calendarId: op.calendarId || 'primary',
            start: op.start,
            end: op.end,
            status: op.status,
            alternativeSlotsCount: null,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
        }
      } else if (op.type === CalendarOpType.Update && op.eventId) {
        updateOps.push(op);
      } else if (op.type === CalendarOpType.Delete && op.eventId) {
        deleteIds.push(op.eventId);
      }
    }

    await db.transaction(async (tx) => {
      if (insertValues.length > 0) {
        await tx.insert(scheduledEvents).values(insertValues);
      }

      const allUpdates = [
        ...upsertUpdates.map(({ existing, op }) =>
          tx
            .update(scheduledEvents)
            .set({
              title: op.title,
              googleEventId: op.googleEventId || null,
              calendarId: op.calendarId || 'primary',
              start: op.start,
              end: op.end,
              status: op.status,
              updatedAt: nowTs,
            })
            .where(and(eq(scheduledEvents.id, existing.id), eq(scheduledEvents.userId, userId))),
        ),
        ...updateOps.map((op) =>
          tx
            .update(scheduledEvents)
            .set({
              title: op.title,
              start: op.start,
              end: op.end,
              status: op.status,
              googleEventId: op.googleEventId || undefined,
              updatedAt: nowTs,
            })
            .where(and(eq(scheduledEvents.id, op.eventId!), eq(scheduledEvents.userId, userId))),
        ),
      ];
      if (allUpdates.length > 0) {
        await Promise.all(allUpdates);
      }

      if (deleteIds.length > 0) {
        await tx
          .delete(scheduledEvents)
          .where(and(inArray(scheduledEvents.id, deleteIds), eq(scheduledEvents.userId, userId)));
      }
    });

    await this.deleteOrphanedGoogleEvents(orphanedGoogleEventIds, calClient, calIdToGoogleCalId);
  }

  /** Delete orphaned Google Calendar events that were replaced during dedup. */
  private async deleteOrphanedGoogleEvents(
    orphanedGoogleEventIds: { googleEventId: string; calendarId: string }[],
    calClient: GoogleCalendarClient,
    calIdToGoogleCalId: Map<string, string>,
  ): Promise<void> {
    if (orphanedGoogleEventIds.length === 0) return;

    const userId = this.userId;
    log.info(
      { userId, orphanCount: orphanedGoogleEventIds.length },
      'Cleaning up orphaned Google Calendar events',
    );
    for (const { googleEventId, calendarId: calId } of orphanedGoogleEventIds) {
      try {
        const isUuid = calId && calId !== 'primary';
        const googleCalId = isUuid ? calIdToGoogleCalId.get(calId) || 'primary' : 'primary';
        await calClient.applyOperations(googleCalId, [
          {
            type: CalendarOpType.Delete,
            googleEventId,
            itemType: ItemType.Habit,
            itemId: '',
            title: '',
            start: '',
            end: '',
            status: EventStatus.Free,
            extendedProperties: {},
          },
        ]);
      } catch (err) {
        log.warn({ userId, googleEventId, err }, 'Failed to delete orphaned Google event');
      }
    }
  }

  private async handlePolledEvents(
    calendarId: string,
    polledEvents: CalendarEvent[],
    manager: CalendarPollerManager,
  ): Promise<void> {
    const userId = this.userId;
    const now = new Date().toISOString();
    let managedEventsMoved = false;
    let externalChanged = false;

    const pollCutoff = new Date(Date.now() - SCHEDULE_LOOKBACK_MS).toISOString();

    const [allScheduled, allCached] = await Promise.all([
      db
        .select()
        .from(scheduledEvents)
        .where(and(eq(scheduledEvents.userId, userId), gte(scheduledEvents.end, pollCutoff))),
      db
        .select()
        .from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.end, pollCutoff))),
    ]);

    const scheduledByGoogleEventId = new Map<string, (typeof allScheduled)[0]>();
    for (const row of allScheduled) {
      if (row.googleEventId) scheduledByGoogleEventId.set(row.googleEventId, row);
    }

    const cachedByGoogleEventId = new Map<string, (typeof allCached)[0]>();
    for (const row of allCached) {
      if (row.googleEventId) cachedByGoogleEventId.set(row.googleEventId, row);
    }

    const deleteGoogleEventIds: string[] = [];
    const updateBatch: Array<{
      googleEventId: string;
      title: string;
      start: string;
      end: string;
      status: string;
      location: string | null;
      isAllDay: boolean;
    }> = [];
    const insertBatch: Array<{
      userId: string;
      calendarId: string;
      googleEventId: string;
      title: string;
      start: string;
      end: string;
      status: string;
      location: string | null;
      isAllDay: boolean;
      updatedAt: string;
    }> = [];

    for (const ev of polledEvents) {
      if (!ev.googleEventId) continue;

      if (ev.isManaged) {
        const result = await this.handleManagedPolledEvent(ev, scheduledByGoogleEventId, now);
        if (result === 'moved') managedEventsMoved = true;
        if (result !== 'external') continue;
      }

      if (!ev.start || !ev.end || !ev.title) {
        if (cachedByGoogleEventId.has(ev.googleEventId)) {
          deleteGoogleEventIds.push(ev.googleEventId);
          externalChanged = true;
        }
        continue;
      }

      const existingCached = cachedByGoogleEventId.get(ev.googleEventId);
      if (existingCached) {
        const newStatus = ev.status || 'busy';
        const newLocation = ev.location || null;
        const newIsAllDay = !ev.start.includes('T');
        const changed =
          existingCached.title !== ev.title ||
          existingCached.start !== ev.start ||
          existingCached.end !== ev.end ||
          existingCached.status !== newStatus ||
          existingCached.location !== newLocation ||
          existingCached.isAllDay !== newIsAllDay;
        if (changed) {
          updateBatch.push({
            googleEventId: ev.googleEventId,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            status: newStatus,
            location: newLocation,
            isAllDay: newIsAllDay,
          });
          externalChanged = true;
        }
      } else {
        insertBatch.push({
          userId,
          calendarId,
          googleEventId: ev.googleEventId,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          status: ev.status || 'busy',
          location: ev.location || null,
          isAllDay: !ev.start.includes('T'),
          updatedAt: now,
        });
        externalChanged = true;
      }
    }

    if (deleteGoogleEventIds.length > 0) {
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, userId),
            inArray(calendarEvents.googleEventId, deleteGoogleEventIds),
          ),
        );
    }

    // Individual updates since Drizzle doesn't support multi-row UPDATE
    for (const upd of updateBatch) {
      await db
        .update(calendarEvents)
        .set({
          title: upd.title,
          start: upd.start,
          end: upd.end,
          status: upd.status,
          location: upd.location,
          isAllDay: upd.isAllDay,
          updatedAt: now,
        })
        .where(
          and(
            eq(calendarEvents.googleEventId, upd.googleEventId),
            eq(calendarEvents.userId, userId),
          ),
        );
    }

    if (insertBatch.length > 0) {
      if (insertBatch.length > 0) {
        log.info({ userId, count: insertBatch.length }, 'New external events (batch)');
      }
      await db
        .insert(calendarEvents)
        .values(insertBatch)
        .onConflictDoUpdate({
          target: [calendarEvents.userId, calendarEvents.googleEventId],
          set: {
            title: sql`EXCLUDED.title`,
            start: sql`EXCLUDED.start`,
            end: sql`EXCLUDED."end"`,
            status: sql`EXCLUDED.status`,
            location: sql`EXCLUDED.location`,
            isAllDay: sql`EXCLUDED.is_all_day`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
        });
    }

    if (managedEventsMoved) {
      manager.markAllWritten();
      debouncedBroadcastToUser(userId, 'schedule_updated', 'Event moved on Google Calendar');
      // Fire-and-forget instead of awaiting to avoid deadlock:
      // handlePolledEvents is called from poll() which may be awaited by
      // forcePoll() inside doRescheduleAndApply, which holds the withLock lock.
      // Awaiting triggerReschedule here would try to acquire the same lock → deadlock.
      void this.triggerReschedule('Managed event moved on Google Calendar').catch((err) => {
        log.error({ userId, err }, 'Reschedule after managed event move failed');
      });
    }

    if (externalChanged) {
      debouncedBroadcastToUser(userId, 'schedule_updated', 'External calendar events changed');
      void this.triggerReschedule('External calendar changed').catch((err) => {
        log.error({ userId, err }, 'Reschedule after external change failed');
      });
    }
  }

  /** Handle a single managed event from polling. Returns 'moved', 'skip', or 'external'. */
  private async handleManagedPolledEvent(
    ev: CalendarEvent,
    scheduledByGoogleEventId: Map<
      string,
      {
        id: string;
        start: string | null;
        end: string | null;
        googleEventId: string | null;
        calendarId: string | null;
        itemType: string | null;
        itemId: string | null;
        title: string | null;
      }
    >,
    now: string,
  ): Promise<'moved' | 'skip' | 'external'> {
    const userId = this.userId;
    if (!ev.start || !ev.end) return 'skip';

    const local = scheduledByGoogleEventId.get(ev.googleEventId!);
    if (!local || !local.start || !local.end) {
      // Not in our scheduledEvents — from another Fluxure instance
      if (!ev.title) return 'skip';
      return 'external';
    }

    const startDiff = Math.abs(new Date(local.start).getTime() - new Date(ev.start).getTime());
    const endDiff = Math.abs(new Date(local.end).getTime() - new Date(ev.end).getTime());
    if (startDiff < 60000 && endDiff < 60000) return 'skip';

    log.info({ userId, title: local.title }, 'Managed event moved');
    await db
      .update(scheduledEvents)
      .set({ start: ev.start, end: ev.end, status: EventStatus.Locked, updatedAt: now })
      .where(and(eq(scheduledEvents.id, local.id), eq(scheduledEvents.userId, userId)));

    if (local.googleEventId) {
      const calIsUuid = local.calendarId && local.calendarId !== 'primary';
      const googleCalId = calIsUuid
        ? this.cachedCalIdToGoogleCalId.get(local.calendarId!) || 'primary'
        : 'primary';
      const op: import('@fluxure/shared').CalendarOperation = {
        type: CalendarOpType.Update,
        eventId: local.id,
        googleEventId: local.googleEventId,
        itemType: (local.itemType || ItemType.Habit) as ItemType,
        itemId: local.itemId || '',
        title: local.title || '',
        start: ev.start,
        end: ev.end,
        status: EventStatus.Locked,
        extendedProperties: {
          [EXTENDED_PROPS.fluxureId]: local.id,
          [EXTENDED_PROPS.itemType]: local.itemType || ItemType.Habit,
          [EXTENDED_PROPS.itemId]: local.itemId?.split('__')[0] || '',
          [EXTENDED_PROPS.status]: EventStatus.Locked,
        },
      };
      await this.calClient.applyOperations(googleCalId, [op]);
    }

    return 'moved';
  }
}

// ============================================================
// SchedulerRegistry — manages UserScheduler instances
// ============================================================

export class SchedulerRegistry {
  private schedulers = new Map<string, UserScheduler>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  async getOrCreate(userId: string): Promise<UserScheduler> {
    // Cancel any pending idle timeout
    const idleTimer = this.idleTimers.get(userId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(userId);
    }

    const existing = this.schedulers.get(userId);
    if (existing && existing.isRunning) return existing;
    // Remove zombie schedulers from concurrent destroy
    if (existing && !existing.isRunning) {
      this.schedulers.delete(userId);
    }

    return withDistributedLock(`lock:scheduler-create:${userId}`, 10_000, async () => {
      // Re-check after acquiring lock (another instance may have won the race)
      const existingAfterLock = this.schedulers.get(userId);
      if (existingAfterLock && existingAfterLock.isRunning) return existingAfterLock;

      // Claim ownership — another instance may own this user in a multi-node deployment
      const claimed = await claimUser(userId);
      if (!claimed) {
        throw new Error('Scheduler owned by another instance');
      }

      return this.createScheduler(userId);
    });
  }

  private async createScheduler(userId: string): Promise<UserScheduler> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || !user.googleRefreshToken) {
      throw new Error(`User ${userId} has no Google connection`);
    }

    const oauth2Client = createOAuth2Client();
    const refreshToken = decrypt(user.googleRefreshToken);
    setCredentials(oauth2Client, refreshToken);

    const scheduler = new UserScheduler(userId, oauth2Client);
    this.schedulers.set(userId, scheduler);
    await scheduler.start();
    return scheduler;
  }

  get(userId: string): UserScheduler | undefined {
    return this.schedulers.get(userId);
  }

  /** Route a webhook notification to the correct user's scheduler. */
  async handleWebhookNotification(userId: string, calendarId: string): Promise<void> {
    try {
      const scheduler = await this.getOrCreate(userId);
      await scheduler.handleWebhookNotification(calendarId);
    } catch (err) {
      log.warn({ userId, err }, 'Webhook: could not create scheduler');
    }
  }

  async destroy(userId: string): Promise<void> {
    const scheduler = this.schedulers.get(userId);
    if (scheduler) {
      await scheduler.stop();
      this.schedulers.delete(userId);
    }
    await releaseUser(userId);
    const idleTimer = this.idleTimers.get(userId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(userId);
    }
  }

  /** Schedule destruction after idle timeout */
  scheduleIdle(userId: string): void {
    const existing = this.idleTimers.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.idleTimers.delete(userId);
      log.info({ userId }, 'Idle timeout, destroying scheduler');
      this.destroy(userId).catch((err) => {
        log.error({ userId, err }, 'Idle destroy failed');
      });
    }, IDLE_TIMEOUT_MS);

    this.idleTimers.set(userId, timer);
  }

  /** Cancel idle timer (e.g., when a new WS connection comes in) */
  cancelIdle(userId: string): void {
    const timer = this.idleTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(userId);
    }
  }

  /** On server startup: start schedulers for recently active users with Google tokens */
  async startAll(): Promise<void> {
    startRefreshLoop();

    const connected = await db.select().from(users).where(isNotNull(users.googleRefreshToken));

    log.info({ userCount: connected.length }, 'Starting schedulers for connected users');

    const CONCURRENCY = SCHEDULER_BOOT_CONCURRENCY;
    let skipped = 0;
    for (let i = 0; i < connected.length; i += CONCURRENCY) {
      const batch = connected.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (user) => {
          try {
            const claimed = await claimUser(user.id);
            if (!claimed) {
              skipped++;
              return;
            }
            await this.getOrCreate(user.id);
          } catch (err) {
            log.error({ userId: user.id, err }, 'Failed to start scheduler');
          }
        }),
      );
    }

    if (skipped > 0) {
      log.info({ skipped }, 'Skipped users owned by other instances');
    }

    this.startCleanupTimer();
  }

  /** Periodically purge old scheduled_events and activity_log (fallback when BullMQ unavailable) */
  private startCleanupTimer(): void {
    if (isQueuesStarted()) return;
    const CLEANUP_INTERVAL_MS = MS_PER_DAY;
    this.cleanupOldScheduleChanges().catch((err) => {
      log.warn({ err }, 'Initial schedule change cleanup failed');
    });
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldScheduleChanges().catch((err) => {
        log.warn({ err }, 'Scheduled cleanup of old schedule changes failed');
      });
    }, CLEANUP_INTERVAL_MS);
  }

  private async cleanupOldScheduleChanges(): Promise<void> {
    const BATCH_SIZE = 5000;
    const BATCH_PAUSE_MS = 100;

    // NOTE: schedule_changes cleanup is handled by data-retention.ts (or BullMQ cleanup:schedule-data).
    // This method only handles scheduled_events and activity_log as a fallback.

    // Purge old scheduled_events globally (not per-user).
    // Events older than the default retention window are forgotten — Google Calendar keeps them.
    try {
      const defaultCutoff = new Date(
        Date.now() - DEFAULT_PAST_EVENT_RETENTION_DAYS * MS_PER_DAY,
      ).toISOString();
      let totalDeleted = 0;
      while (true) {
        // Find stale events: end < cutoff (end is text/ISO, compare as string works for ISO dates)
        const stale = await db
          .select({ id: scheduledEvents.id })
          .from(scheduledEvents)
          .where(lt(scheduledEvents.end, defaultCutoff))
          .limit(BATCH_SIZE);
        if (stale.length === 0) break;
        await db.delete(scheduledEvents).where(
          inArray(
            scheduledEvents.id,
            stale.map((r) => r.id),
          ),
        );
        totalDeleted += stale.length;
        if (stale.length < BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }
      if (totalDeleted > 0) {
        log.info({ totalDeleted }, 'Past scheduled events cleanup: purged old rows');
      }
    } catch (err) {
      log.error({ err }, 'Past scheduled events cleanup failed');
    }

    // Clean up old activity log entries (90 days)
    try {
      const ACTIVITY_LOG_RETENTION_DAYS = 90;
      const activityCutoff = new Date(
        Date.now() - ACTIVITY_LOG_RETENTION_DAYS * MS_PER_DAY,
      ).toISOString();
      let totalDeleted = 0;
      while (true) {
        const stale = await db
          .select({ id: activityLog.id })
          .from(activityLog)
          .where(lt(activityLog.createdAt, activityCutoff))
          .limit(BATCH_SIZE);
        if (stale.length === 0) break;
        await db.delete(activityLog).where(
          inArray(
            activityLog.id,
            stale.map((r) => r.id),
          ),
        );
        totalDeleted += stale.length;
        if (stale.length < BATCH_SIZE) break;
        await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }
      if (totalDeleted > 0) {
        log.info(
          { cutoff: activityCutoff, totalDeleted },
          'Activity log cleanup: deleted old rows',
        );
      }
    } catch (err) {
      log.error({ err }, 'Activity log cleanup failed');
    }

    // Clean up orphaned scheduled events whose source entity no longer exists.
    // This catches items deleted while no reschedule ran (e.g., server was down).
    await this.cleanupOrphanedScheduledEvents(BATCH_SIZE, BATCH_PAUSE_MS);
  }

  /** Delete scheduled events whose parent habit/task/meeting has been deleted. */
  private async cleanupOrphanedScheduledEvents(
    batchSize: number,
    batchPauseMs: number,
  ): Promise<void> {
    try {
      // Collect all valid item IDs across all entity tables
      const [allHabitIds, allTaskIds, allMeetingIds] = await Promise.all([
        db.select({ id: habits.id }).from(habits),
        db.select({ id: tasks.id }).from(tasks),
        db.select({ id: smartMeetings.id }).from(smartMeetings),
      ]);
      const validEntityIds = new Set([
        ...allHabitIds.map((r) => r.id),
        ...allTaskIds.map((r) => r.id),
        ...allMeetingIds.map((r) => r.id),
      ]);

      // Find scheduled events with an itemId whose base ID (before __)
      // doesn't match any existing entity
      let totalDeleted = 0;
      let offset = 0;
      while (true) {
        const batch = await db
          .select({ id: scheduledEvents.id, itemId: scheduledEvents.itemId })
          .from(scheduledEvents)
          .limit(batchSize)
          .offset(offset);
        if (batch.length === 0) break;

        const orphanIds = batch
          .filter((row) => {
            if (!row.itemId) return false;
            const baseId = row.itemId.split('__')[0];
            return !validEntityIds.has(baseId);
          })
          .map((r) => r.id);

        if (orphanIds.length > 0) {
          await db.delete(scheduledEvents).where(inArray(scheduledEvents.id, orphanIds));
          totalDeleted += orphanIds.length;
        }

        if (batch.length < batchSize) break;
        offset += batchSize;
        await new Promise((r) => setTimeout(r, batchPauseMs));
      }

      if (totalDeleted > 0) {
        log.info({ totalDeleted }, 'Orphaned scheduled events cleanup: deleted stale rows');
      }
    } catch (err) {
      log.error({ err }, 'Orphaned scheduled events cleanup failed');
    }
  }

  /** On graceful shutdown: stop all schedulers */
  async stopAll(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    // Release ownership for each scheduler before stopping
    await Promise.allSettled(
      [...this.schedulers.entries()].map(async ([userId, s]) => {
        await s.stop();
        await releaseUser(userId);
      }),
    );
    this.schedulers.clear();
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    await stopRefreshLoop();
  }
}

// Singleton instance
export const schedulerRegistry = new SchedulerRegistry();

/** Standalone cleanup function for use by BullMQ maintenance worker */
export async function cleanupScheduleData(): Promise<void> {
  const cutoff = new Date(Date.now() - SCHEDULE_CHANGES_RETENTION_DAYS * MS_PER_DAY).toISOString();
  await db.delete(scheduleChanges).where(lt(scheduleChanges.createdAt, cutoff));
  log.info({ cutoff }, 'Schedule changes cleanup: deleted old rows');

  const defaultCutoff = new Date(
    Date.now() - DEFAULT_PAST_EVENT_RETENTION_DAYS * MS_PER_DAY,
  ).toISOString();
  await db.delete(scheduledEvents).where(lt(scheduledEvents.end, defaultCutoff));
  log.info('Past scheduled events cleanup: purged old rows');

  // Clean up old activity log entries (90 days)
  const ACTIVITY_LOG_RETENTION_DAYS = 90;
  const activityCutoff = new Date(
    Date.now() - ACTIVITY_LOG_RETENTION_DAYS * MS_PER_DAY,
  ).toISOString();
  await db.delete(activityLog).where(lt(activityLog.createdAt, activityCutoff));
  log.info({ cutoff: activityCutoff }, 'Activity log cleanup: deleted old rows');

  // Clean up orphaned scheduled events (source entity deleted, no reschedule ran)
  const [allHabitIds, allTaskIds, allMeetingIds] = await Promise.all([
    db.select({ id: habits.id }).from(habits),
    db.select({ id: tasks.id }).from(tasks),
    db.select({ id: smartMeetings.id }).from(smartMeetings),
  ]);
  const validEntityIds = new Set([
    ...allHabitIds.map((r) => r.id),
    ...allTaskIds.map((r) => r.id),
    ...allMeetingIds.map((r) => r.id),
  ]);

  const allScheduled = await db
    .select({ id: scheduledEvents.id, itemId: scheduledEvents.itemId })
    .from(scheduledEvents);
  const orphanIds = allScheduled
    .filter((row) => {
      if (!row.itemId) return false;
      const baseId = row.itemId.split('__')[0];
      return !validEntityIds.has(baseId);
    })
    .map((r) => r.id);

  if (orphanIds.length > 0) {
    await db.delete(scheduledEvents).where(inArray(scheduledEvents.id, orphanIds));
    log.info(
      { totalDeleted: orphanIds.length },
      'Orphaned scheduled events cleanup: deleted stale rows',
    );
  }
}
