import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockDb } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

  let whereResults: unknown[][] = [[]];
  let whereCallIndex = 0;
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
    (result as any).limit = mockLimit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
    (result as any).orderBy = mockOrderBy;
    return result;
  }

  function makeLimitResult(data: unknown[]) {
    const result = { offset: mockOffset };
    mockOffset.mockResolvedValue(data);
    return result;
  }

  mockOrderBy.mockImplementation(() => {
    return { limit: mockLimit };
  });

  mockWhere.mockImplementation(() => {
    const idx = whereCallIndex++;
    const data = idx < whereResults.length ? whereResults[idx] : [];
    mockLimit.mockReturnValue(makeLimitResult(data));
    mockLimit.mockImplementation(() => {
      const limitResult = Promise.resolve(data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
      (limitResult as any).offset = mockOffset;
      return limitResult;
    });
    return makeWhereResult(data);
  });

  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callback
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        insert: vi.fn().mockReturnValue({ values: mockValues }),
        update: vi.fn().mockReturnValue({ set: mockSet }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      };
      return fn(tx);
    }),
    _mockWhere: mockWhere,
    _mockFrom: mockFrom,
    _mockValues: mockValues,
    _mockReturning: mockReturning,
    _mockSet: mockSet,
    _mockWhereReturning: mockWhereReturning,
    _mockDeleteWhere: mockDeleteWhere,
    _mockLimit: mockLimit,
    _mockOffset: mockOffset,
    _mockOrderBy: mockOrderBy,
    _setWhereResults: (results: unknown[][]) => {
      whereResults = results;
      whereCallIndex = 0;
    },
  };

  return { mockDb };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../cache/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
  getSubscriberClient: vi.fn().mockReturnValue(null),
  initRedis: vi.fn().mockResolvedValue(undefined),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  cacheHashGet: vi.fn().mockResolvedValue(null),
  cacheHashSet: vi.fn().mockResolvedValue(undefined),
  cacheHashDelAll: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cache/user-settings.js', () => ({
  getUserTimezoneCached: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('@fluxure/engine', () => ({
  reschedule: vi.fn().mockReturnValue({ operations: [], unschedulable: [] }),
  generateCandidateSlots: vi.fn().mockReturnValue([]),
  scoreSlot: vi.fn().mockReturnValue(0),
  buildTimeline: vi.fn().mockReturnValue([]),
  calculateScheduleQuality: vi.fn().mockReturnValue({
    overall: 85,
    components: { placement: 90, idealTime: 80, focus: 85, buffers: 75, priorities: 95 },
  }),
}));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    get: vi.fn().mockReturnValue(undefined),
    getOrCreate: vi.fn().mockRejectedValue(new Error('Google not connected')),
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
  },
}));
vi.mock('../routes/schedule-helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/schedule-helpers.js')>();
  return {
    ...actual,
    getUserSettings: vi.fn().mockResolvedValue({ timezone: 'UTC', schedulingWindowDays: 14 }),
    loadDomainObjectsForQuality: vi.fn().mockResolvedValue({
      allHabits: [],
      allTasks: [],
      allMeetings: [],
      allFocusRules: [],
      buf: {
        id: 'default',
        travelTimeMinutes: 15,
        decompressionMinutes: 10,
        breakBetweenItemsMinutes: 5,
        applyDecompressionTo: 'all',
      },
      userSettings: { timezone: 'UTC', schedulingWindowDays: 14 },
    }),
    buildScheduleItemsForDay: vi.fn().mockReturnValue([]),
    buildPlacementsFromRows: vi
      .fn()
      .mockReturnValue({ placements: new Map(), focusMinutesPlaced: 0 }),
    computeQualityForDay: vi.fn().mockReturnValue({
      overall: 85,
      components: { placement: 90, idealTime: 80, focus: 85, buffers: 75, priorities: 95 },
    }),
  };
});
vi.mock('../routes/schedule-actions.js', () => ({
  registerScheduleActions: vi.fn(),
}));
vi.mock('../distributed/lock.js', () => ({
  withDistributedLock: vi.fn(),
  LockNotAcquiredError: class extends Error {},
}));
vi.mock('../logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../utils/converters.js', () => ({
  toHabit: vi.fn((x: unknown) => x),
  toTask: vi.fn((x: unknown) => x),
  toMeeting: vi.fn((x: unknown) => x),
  toFocusRule: vi.fn((x: unknown) => x),
  toBufConfig: vi.fn((x: unknown) => x),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import habitsRouter from '../routes/habits.js';
import analyticsRouter from '../routes/analytics.js';
import activityRouter from '../routes/activity.js';
import scheduleRouter from '../routes/schedule.js';

const TEST_USER_ID = 'test-user-id';

/** Create a test app with a specific plan (free or pro). */
function createTestAppWithPlan(
  prefix: string,
  router: express.Router,
  plan: 'free' | 'pro',
): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    req.userId = TEST_USER_ID;
    req.userEmail = 'test@example.com';
    req.userPlan = plan;
    next();
  });
  app.use(`/api/${prefix}`, router);
  return app;
}

const freeHabitsApp = createTestAppWithPlan('habits', habitsRouter, 'free');
const proHabitsApp = createTestAppWithPlan('habits', habitsRouter, 'pro');
const freeAnalyticsApp = createTestAppWithPlan('analytics', analyticsRouter, 'free');
const proAnalyticsApp = createTestAppWithPlan('analytics', analyticsRouter, 'pro');
const freeActivityApp = createTestAppWithPlan('activity', activityRouter, 'free');
const proActivityApp = createTestAppWithPlan('activity', activityRouter, 'pro');
const freeScheduleApp = createTestAppWithPlan('schedule', scheduleRouter, 'free');
const proScheduleApp = createTestAppWithPlan('schedule', scheduleRouter, 'pro');

const validHabitBody = {
  name: 'Morning Run',
  windowStart: '06:00',
  windowEnd: '09:00',
  idealTime: '07:00',
  durationMin: 30,
  durationMax: 60,
  frequency: 'daily',
};

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

describe('Count gates — POST /api/habits', () => {
  beforeEach(resetMocks);

  it('returns 201 when free user is under the limit (count < 3)', async () => {
    const newHabit = { id: 'new-id', ...validHabitBody, priority: 3 };
    mockDb._setWhereResults([[{ count: 2 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([newHabit]);

    const res = await request(freeHabitsApp).post('/api/habits').send(validHabitBody);

    expect(res.status).toBe(201);
  });

  it('returns 403 with plan_limit_reached when free user is at the limit (count = 3)', async () => {
    mockDb._setWhereResults([[{ count: 3 }]]);

    const res = await request(freeHabitsApp).post('/api/habits').send(validHabitBody);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxHabits');
    expect(res.body.current).toBe(3);
    expect(res.body.max).toBe(3);
    expect(res.body.upgrade_message).toContain('Upgrade to Pro');
    expect(res.body.upgrade_url).toBe('/settings#billing');
  });

  it('returns 201 for pro user regardless of count (unlimited)', async () => {
    const newHabit = { id: 'new-id', ...validHabitBody, priority: 3 };
    mockDb._setWhereResults([[{ count: 50 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([newHabit]);

    const res = await request(proHabitsApp).post('/api/habits').send(validHabitBody);

    expect(res.status).toBe(201);
  });
});

describe('Capability gates — GET /api/analytics', () => {
  beforeEach(resetMocks);

  it('returns 403 feature_not_available for free users', async () => {
    const res = await request(freeAnalyticsApp).get('/api/analytics');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.feature).toBe('analytics');
    expect(res.body.upgrade_message).toContain('Upgrade to Pro');
    expect(res.body.upgrade_url).toBe('/settings#billing');
  });

  it('returns 200 for pro users', async () => {
    mockDb._setWhereResults([[], []]);

    const res = await request(proAnalyticsApp).get('/api/analytics');

    expect(res.status).toBe(200);
  });
});

describe('Capability gates — GET /api/activity', () => {
  beforeEach(resetMocks);

  it('returns 403 feature_not_available for free users', async () => {
    const res = await request(freeActivityApp).get('/api/activity');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.feature).toBe('activity log');
    expect(res.body.upgrade_message).toContain('Upgrade to Pro');
  });

  it('returns 200 for pro users', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(proActivityApp).get('/api/activity');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Capability gates — GET /api/schedule/quality', () => {
  beforeEach(resetMocks);

  it('returns only overall score for free users (no components breakdown)', async () => {
    mockDb._setWhereResults([
      [{ timezone: 'UTC', schedulingWindowDays: 14 }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);

    const res = await request(freeScheduleApp).get('/api/schedule/quality?date=2026-03-15');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall');
    expect(res.body).not.toHaveProperty('components');
  });

  it('returns full breakdown for pro users', async () => {
    mockDb._setWhereResults([
      [{ timezone: 'UTC', schedulingWindowDays: 90 }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);

    const res = await request(proScheduleApp).get('/api/schedule/quality?date=2026-03-15');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall');
    expect(res.body).toHaveProperty('components');
  });
});
