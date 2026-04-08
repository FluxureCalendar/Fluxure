import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers.js';

const { mockDb } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });

  return {
    mockDb: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      insert: vi.fn().mockReturnValue({ values: mockValues }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callback
      transaction: vi.fn().mockImplementation(async (cb: any) =>
        cb({
          select: vi.fn().mockReturnValue({ from: mockFrom }),
          insert: vi.fn().mockReturnValue({ values: mockValues }),
          update: vi.fn().mockReturnValue({ set: mockSet }),
          delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
        }),
      ),
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockValues: mockValues,
      _mockReturning: mockReturning,
      _mockSet: mockSet,
      _mockSetWhere: mockSetWhere,
      _mockDeleteWhere: mockDeleteWhere,
      _mockOrderBy: mockOrderBy,
      _mockLimit: mockLimit,
    },
  };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));

vi.mock('@fluxure/engine', () => ({
  reschedule: vi.fn().mockReturnValue({ operations: [], unschedulable: [] }),
  generateCandidateSlots: vi.fn().mockReturnValue([]),
  scoreSlot: vi.fn().mockReturnValue(0),
  buildTimeline: vi.fn().mockReturnValue([]),
  calculateScheduleQuality: vi.fn().mockReturnValue({ overall: 100 }),
}));

vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    get: vi.fn().mockReturnValue(undefined),
    getOrCreate: vi.fn().mockRejectedValue(new Error('Google not connected')),
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
  },
}));
vi.mock('../distributed/lock.js', () => ({
  withDistributedLock: vi
    .fn()
    .mockImplementation(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  LockNotAcquiredError: class LockNotAcquiredError extends Error {
    constructor() {
      super('Lock not acquired');
      this.name = 'LockNotAcquiredError';
    }
  },
}));
vi.mock('../cache/redis.js', () => ({
  cacheHashGet: vi.fn().mockResolvedValue(null),
  cacheHashSet: vi.fn().mockResolvedValue(undefined),
  cacheHashDelAll: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn().mockReturnValue(null),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../cache/user-settings.js', () => ({
  invalidateUserSettingsCache: vi.fn().mockResolvedValue(undefined),
  getCachedUserSettings: vi.fn().mockResolvedValue(null),
}));
vi.mock('../routes/schedule-helpers.js', () => ({
  getUserSettings: vi.fn().mockResolvedValue({
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
  }),
  recordScheduleChanges: vi.fn().mockResolvedValue(undefined),
  loadDomainObjectsForQuality: vi.fn().mockResolvedValue({
    allHabits: [],
    allTasks: [],
    allMeetings: [],
    allFocusRules: [],
    buf: { breakBetweenItemsMinutes: 5 },
    userSettings: {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '07:00', end: '22:00' },
      timezone: 'America/New_York',
      schedulingWindowDays: 14,
    },
  }),
  buildScheduleItemsForDay: vi.fn().mockReturnValue([]),
  buildPlacementsFromRows: vi
    .fn()
    .mockReturnValue({ placements: new Map(), focusMinutesPlaced: 0 }),
  computeQualityForDay: vi.fn().mockReturnValue({ overall: 100, components: {} }),
  buildScheduleItemFromEntity: vi.fn().mockReturnValue({ id: 'item-1', duration: 60 }),
}));
vi.mock('../routes/analytics.js', () => ({
  invalidateAnalyticsCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../routes/schedule-actions.js', () => ({
  registerScheduleActions: vi.fn(),
}));
vi.mock('../utils/converters.js', () => ({
  toHabit: vi.fn().mockImplementation((x: unknown) => x),
  toTask: vi.fn().mockImplementation((x: unknown) => x),
  toMeeting: vi.fn().mockImplementation((x: unknown) => x),
  toFocusRule: vi.fn().mockImplementation((x: unknown) => x),
  toBufConfig: vi.fn().mockImplementation((x: unknown) => x),
}));
vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
}));
vi.mock('../middleware/plan-gate.js', () => ({
  sendFeatureGated: vi.fn(),
  checkEntityLimit: vi.fn().mockReturnValue(true),
  sendPlanLimitError: vi.fn(),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import scheduleRouter from '../routes/schedule.js';

const app = createTestApp('schedule', scheduleRouter);

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockWhere.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockSetWhere });
  mockDb._mockSetWhere.mockResolvedValue(undefined);
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
  mockDb._mockOrderBy.mockReturnValue({ limit: mockDb._mockLimit });
  mockDb._mockLimit.mockResolvedValue([]);
}

// ============================================================
// GET /api/schedule
// ============================================================

describe('GET /api/schedule', () => {
  beforeEach(resetMocks);

  it('returns empty array when no events exist', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).get('/api/schedule');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns 400 for invalid start date', async () => {
    const res = await request(app).get('/api/schedule?start=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns 400 for invalid end date', async () => {
    const res = await request(app).get('/api/schedule?start=2026-01-01T00:00:00Z&end=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns managed events filtered by date range', async () => {
    const managedEvents = [
      {
        id: 'ev-1',
        itemType: 'habit',
        itemId: 'h-1',
        userId: 'test-user-id',
        googleEventId: null,
        calendarId: null,
        start: '2026-03-05T09:00:00Z',
        end: '2026-03-05T10:00:00Z',
        status: 'free',
        title: 'Morning Run',
        alternativeSlotsCount: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    mockDb._mockWhere.mockResolvedValueOnce([]).mockResolvedValueOnce(managedEvents);

    const res = await request(app).get(
      '/api/schedule?start=2026-03-01T00:00:00Z&end=2026-03-31T00:00:00Z',
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe('ev-1');
    expect(res.body[0].calendarId).toBeNull();
  });

  it('returns events without date filter (returns all)', async () => {
    const managedEvents = [
      {
        id: 'ev-1',
        itemType: 'habit',
        itemId: 'h-1',
        userId: 'test-user-id',
        googleEventId: null,
        calendarId: null,
        start: '2026-03-05T09:00:00Z',
        end: '2026-03-05T10:00:00Z',
        status: 'free',
        title: 'Test Event',
      },
    ];

    mockDb._mockWhere.mockResolvedValueOnce([]).mockResolvedValueOnce(managedEvents);

    const res = await request(app).get('/api/schedule');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].calendarId).toBeNull();
  });

  it('returns 400 when date range exceeds 90 days', async () => {
    const res = await request(app).get(
      '/api/schedule?start=2026-01-01T00:00:00Z&end=2026-06-01T00:00:00Z',
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('90 days');
  });

  it('returns 400 when start is after end', async () => {
    const res = await request(app).get(
      '/api/schedule?start=2026-03-31T00:00:00Z&end=2026-03-01T00:00:00Z',
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('start must be before end');
  });
});

// ============================================================
// POST /api/schedule/reschedule
// ============================================================

describe('POST /api/schedule/reschedule', () => {
  beforeEach(resetMocks);

  it('runs reschedule and returns result', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).post('/api/schedule/reschedule');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reschedule complete');
    expect(res.body.operationsApplied).toBe(0);
    expect(res.body.unschedulable).toEqual([]);
  });

  it('uses Google scheduler when available', async () => {
    const { schedulerRegistry } = await import('../scheduler-registry.js');
    const mockTrigger = vi.fn().mockResolvedValue(3);
    vi.mocked(schedulerRegistry.getOrCreate).mockResolvedValueOnce({
      triggerReschedule: mockTrigger,
    } as never);

    const res = await request(app).post('/api/schedule/reschedule');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reschedule complete');
    expect(res.body.operationsApplied).toBe(3);
    expect(mockTrigger).toHaveBeenCalledWith('Manual reschedule');
  });

  it('broadcasts schedule_updated after reschedule', async () => {
    const { broadcastToUser } = await import('../ws.js');
    mockDb._mockWhere.mockResolvedValue([]);

    await request(app).post('/api/schedule/reschedule');

    expect(broadcastToUser).toHaveBeenCalledWith(
      'test-user-id',
      'schedule_updated',
      'Manual reschedule',
    );
  });
});

// ============================================================
// GET /api/schedule/changes (diff logging)
// ============================================================

describe('GET /api/schedule/changes', () => {
  beforeEach(resetMocks);

  it('returns empty array when no changes exist', async () => {
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await request(app).get('/api/schedule/changes');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns changes with default limit', async () => {
    const changes = [
      {
        id: 'ch-1',
        userId: 'test-user-id',
        batchId: 'batch-1',
        changeType: 'created',
        title: 'Morning Run',
        createdAt: '2026-03-20T10:00:00Z',
      },
    ];
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(changes),
        }),
      }),
    });

    const res = await request(app).get('/api/schedule/changes');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].changeType).toBe('created');
  });

  it('accepts since parameter for filtering', async () => {
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await request(app).get('/api/schedule/changes?since=2026-03-15T00:00:00Z');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('accepts limit parameter', async () => {
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await request(app).get('/api/schedule/changes?limit=10');

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await request(app).get('/api/schedule/changes?limit=0');

    expect(res.status).toBe(400);
  });
});

// ============================================================
// GET /api/schedule/quality
// ============================================================

describe('GET /api/schedule/quality', () => {
  beforeEach(resetMocks);

  it('returns quality score for today by default', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).get('/api/schedule/quality');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall');
  });

  it('returns quality score for a specific date', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).get('/api/schedule/quality?date=2026-03-20');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall');
  });

  it('returns 400 for invalid date format', async () => {
    const res = await request(app).get('/api/schedule/quality?date=not-a-date');

    expect(res.status).toBe(400);
  });

  it('returns cached quality score when available', async () => {
    const { cacheHashGet } = await import('../cache/redis.js');
    vi.mocked(cacheHashGet).mockResolvedValueOnce({ overall: 85, components: {} } as never);

    const res = await request(app).get('/api/schedule/quality?date=2026-03-20');

    expect(res.status).toBe(200);
    expect(res.body.overall).toBe(85);
  });
});

// ============================================================
// GET /api/schedule/:itemId/alternatives
// ============================================================

describe('GET /api/schedule/:itemId/alternatives', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid UUID format', async () => {
    const res = await request(app).get('/api/schedule/not-a-uuid/alternatives');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid itemId format');
  });

  it('returns 404 when item not found', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).get(
      '/api/schedule/00000000-0000-0000-0000-000000000001/alternatives',
    );

    expect(res.status).toBe(404);
  });
});
