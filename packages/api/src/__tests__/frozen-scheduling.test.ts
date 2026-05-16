import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Capture each .where() call predicate so tests can assert frozen=false is present.
 */
const whereCalls: unknown[] = [];

vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => ({ __eq: val }),
    and: (...args: unknown[]) => ({ __and: args }),
  };
});

vi.mock('../db/pg-index.js', () => {
  function makeSelectChain() {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((pred: unknown) => {
        whereCalls.push(pred);
        return Promise.resolve([]);
      }),
    };
  }

  return {
    db: {
      select: vi.fn().mockImplementation(() => makeSelectChain()),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    },
  };
});

vi.mock('../cache/user-settings.js', () => ({
  getUserSettingsCached: vi.fn().mockResolvedValue({
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'UTC',
    schedulingWindowDays: 14,
    trimCompletedEvents: true,
  }),
  getUserTimezoneCached: vi.fn().mockResolvedValue('UTC'),
}));

vi.mock('@fluxure/engine', () => ({
  calculateScheduleQuality: vi.fn().mockReturnValue({ overall: 100 }),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../google/index.js', () => ({
  createOAuth2Client: vi.fn(),
  setCredentials: vi.fn(),
  GoogleCalendarClient: class GoogleCalendarClient {
    constructor(_oauth2Client: unknown) {}
  },
  CalendarPollerManager: class CalendarPollerManager {
    constructor() {}
    startAll() {
      return Promise.resolve();
    }
    stopAll() {
      return Promise.resolve();
    }
  },
}));

vi.mock('../crypto.js', () => ({ decrypt: vi.fn().mockReturnValue('token') }));

vi.mock('../routes/schedule.js', () => ({ recordScheduleChanges: vi.fn().mockResolvedValue([]) }));

vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  debouncedBroadcastToUser: vi.fn(),
}));

vi.mock('../config.js', () => ({
  IDLE_TIMEOUT_MS: 1800000,
  SCHEDULE_CHANGES_RETENTION_DAYS: 30,
  isSelfHosted: vi.fn().mockReturnValue(false),
}));

vi.mock('../workers/pool.js', () => ({ getWorkerPool: vi.fn().mockReturnValue(null) }));

vi.mock('../cache/redis.js', () => ({ cacheHashDelAll: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../utils/converters.js', () => ({
  toHabit: vi.fn().mockImplementation((r: unknown) => r),
  toTask: vi.fn().mockImplementation((r: unknown) => r),
  toMeeting: vi.fn().mockImplementation((r: unknown) => r),
  toFocusRule: vi.fn().mockImplementation((r: unknown) => r),
}));

vi.mock('../distributed/lock.js', () => ({
  withDistributedLock: vi
    .fn()
    .mockImplementation((_key: unknown, _ttl: unknown, fn: () => Promise<unknown>) => fn()),
  LockNotAcquiredError: class LockNotAcquiredError extends Error {},
}));

vi.mock('../distributed/scheduler-owner.js', () => ({
  claimUser: vi.fn().mockResolvedValue(true),
  releaseUser: vi.fn().mockResolvedValue(undefined),
  startRefreshLoop: vi.fn(),
  stopRefreshLoop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../jobs/queues.js', () => ({ isQueuesStarted: vi.fn().mockReturnValue(false) }));

vi.mock('../jobs/habit-auto-complete.js', () => ({
  registerBulkForUser: vi.fn().mockResolvedValue(undefined),
  cancelAllForUser: vi.fn().mockResolvedValue(undefined),
}));

const { loadDomainObjectsForQuality } = await import('../routes/schedule-helpers.js');
const { UserScheduler } = await import('../scheduler-registry.js');

beforeEach(() => {
  whereCalls.length = 0;
  vi.clearAllMocks();
});

/**
 * Recursively collect all __eq values from a predicate tree built by the
 * mocked eq/and helpers. This lets us assert that frozen=false (or more
 * precisely __eq: false from eq(table.frozen, false)) appears in the tree.
 */
function collectEqValues(pred: unknown): unknown[] {
  if (!pred || typeof pred !== 'object') return [];
  const p = pred as Record<string, unknown>;
  if ('__eq' in p) return [p.__eq];
  if ('__and' in p && Array.isArray(p.__and)) {
    return (p.__and as unknown[]).flatMap(collectEqValues);
  }
  return [];
}

describe('frozen exclusion in scheduling load queries', () => {
  describe('loadDomainObjectsForQuality (schedule-helpers)', () => {
    it('habits scheduling load includes frozen=false in where predicate', async () => {
      await loadDomainObjectsForQuality('user-1');

      const habitsPredicate = whereCalls[0];
      const eqValues = collectEqValues(habitsPredicate);
      expect(eqValues).toContain(false);
    });

    it('tasks scheduling load includes frozen=false in where predicate', async () => {
      await loadDomainObjectsForQuality('user-1');

      const tasksPredicate = whereCalls[1];
      const eqValues = collectEqValues(tasksPredicate);
      expect(eqValues).toContain(false);
    });

    it('smartMeetings scheduling load includes frozen=false in where predicate', async () => {
      await loadDomainObjectsForQuality('user-1');

      const meetingsPredicate = whereCalls[2];
      const eqValues = collectEqValues(meetingsPredicate);
      expect(eqValues).toContain(false);
    });

    it('tasks predicate still includes open status alongside frozen exclusion', async () => {
      await loadDomainObjectsForQuality('user-1');

      const tasksPredicate = whereCalls[1];
      const eqValues = collectEqValues(tasksPredicate);
      expect(eqValues).toContain('open');
      expect(eqValues).toContain(false);
    });

    it('non-frozen active habits are included (frozen=false predicate means unfrozen rows pass)', async () => {
      await loadDomainObjectsForQuality('user-1');

      const habitsPredicate = whereCalls[0];
      const eqValues = collectEqValues(habitsPredicate);
      expect(eqValues).toContain(true);
      expect(eqValues).toContain(false);
    });
  });

  describe('UserScheduler.loadDomainObjects (scheduler-registry)', () => {
    it('habits scheduling load includes frozen=false and enabled=true in where predicate', async () => {
      const scheduler = new UserScheduler('user-reg-1', {} as never);
      await (scheduler as unknown as { loadDomainObjects(): Promise<unknown> }).loadDomainObjects();

      const habitsPredicate = whereCalls[0];
      const eqValues = collectEqValues(habitsPredicate);
      expect(eqValues).toContain(false);
      expect(eqValues).toContain(true);
    });

    it('tasks scheduling load includes frozen=false and enabled=true in where predicate', async () => {
      const scheduler = new UserScheduler('user-reg-2', {} as never);
      await (scheduler as unknown as { loadDomainObjects(): Promise<unknown> }).loadDomainObjects();

      const tasksPredicate = whereCalls[1];
      const eqValues = collectEqValues(tasksPredicate);
      expect(eqValues).toContain(false);
      expect(eqValues).toContain(true);
    });

    it('smartMeetings scheduling load includes frozen=false and enabled=true in where predicate', async () => {
      const scheduler = new UserScheduler('user-reg-3', {} as never);
      await (scheduler as unknown as { loadDomainObjects(): Promise<unknown> }).loadDomainObjects();

      const meetingsPredicate = whereCalls[2];
      const eqValues = collectEqValues(meetingsPredicate);
      expect(eqValues).toContain(false);
      expect(eqValues).toContain(true);
    });
  });
});
