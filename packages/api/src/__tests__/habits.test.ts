import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockHabit, TEST_USER_ID, TEST_UUID_1 } from './helpers.js';

// vi.hoisted runs before imports, so createMockDb cannot be called here.
// Instead, we duplicate the minimal mock setup inline (vi.hoisted requirement).
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

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
    (result as any).limit = mockLimit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
    (result as any).orderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    return result;
  }

  function makeLimitResult(data: unknown[]) {
    const result = { offset: mockOffset };
    mockOffset.mockResolvedValue(data);
    return result;
  }

  mockWhere.mockImplementation(() => {
    const idx = whereCallIndex++;
    const data = idx < whereResults.length ? whereResults[idx] : [];
    mockLimit.mockReturnValue(makeLimitResult(data));
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
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../routes/activity.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cache/user-settings.js', () => ({
  getUserTimezoneCached: vi.fn().mockResolvedValue('America/New_York'),
}));
vi.mock('../utils/cycle-detection.js', () => ({
  detectCycle: vi.fn().mockReturnValue(false),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import habitsRouter from '../routes/habits.js';

const app = createTestApp('habits', habitsRouter);

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

const VALID_HABIT_BODY = {
  name: 'Morning Run',
  windowStart: '06:00',
  windowEnd: '09:00',
  idealTime: '07:00',
  durationMin: 30,
  durationMax: 60,
  days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
};

const VALID_UUID = TEST_UUID_1;
const OTHER_UUID = '00000000-0000-0000-0000-000000000099';

// ─── GET /api/habits ──────────────────────────────────────────────

describe('GET /api/habits', () => {
  beforeEach(resetMocks);

  it('returns empty list when no habits exist', async () => {
    mockDb._setWhereResults([[]]);
    const res = await request(app).get('/api/habits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns list of habits', async () => {
    const row = createMockHabit();
    mockDb._setWhereResults([[row]]);

    const res = await request(app).get('/api/habits');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Morning Run');
    expect(res.body[0].days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('returns multiple habits sorted by DB order', async () => {
    const rows = [
      createMockHabit({ id: 'a0000000-0000-0000-0000-000000000001', name: 'Run' }),
      createMockHabit({ id: 'b0000000-0000-0000-0000-000000000002', name: 'Meditate' }),
    ];
    mockDb._setWhereResults([rows]);

    const res = await request(app).get('/api/habits');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Run');
    expect(res.body[1].name).toBe('Meditate');
  });
});

// ─── GET /api/habits/:id ──────────────────────────────────────────

describe('GET /api/habits/:id', () => {
  beforeEach(resetMocks);

  it('returns a single habit by ID', async () => {
    const row = createMockHabit();
    mockDb._setWhereResults([[row]]);

    const res = await request(app).get(`/api/habits/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Morning Run');
    expect(res.body.id).toBe(VALID_UUID);
  });

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).get(`/api/habits/${OTHER_UUID}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).get('/api/habits/not-a-uuid');

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/habits ─────────────────────────────────────────────

describe('POST /api/habits', () => {
  beforeEach(resetMocks);

  it('creates a habit with valid body', async () => {
    const newHabit = createMockHabit({ id: 'new-id' });
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([newHabit]);

    const res = await request(app).post('/api/habits').send(VALID_HABIT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Morning Run');
  });

  it('creates a habit with all optional fields', async () => {
    const newHabit = createMockHabit({
      id: 'new-id',
      days: ['mon', 'wed', 'fri'],
      schedulingHours: 'personal',
      color: '#ff0000',
      autoDecline: true,
      skipBuffer: true,
      notifications: true,
    });
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([newHabit]);

    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        days: ['mon', 'wed', 'fri'],
        schedulingHours: 'personal',
        color: '#ff0000',
        autoDecline: true,
        skipBuffer: true,
        notifications: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Morning Run');
  });

  it('returns 400 with missing required fields', async () => {
    const res = await request(app).post('/api/habits').send({ name: 'Missing fields' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with empty days array', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        days: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid priority (out of range)', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        priority: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid time format', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        windowStart: '25:00',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when durationMin > durationMax', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        durationMin: 120,
        durationMax: 30,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('allows overnight windows where windowEnd < windowStart', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        windowStart: '22:00',
        windowEnd: '06:00',
      });

    // Should not fail validation — engine supports midnight crossover
    expect(res.status).not.toBe(400);
  });

  it('returns 400 when windowStart === windowEnd', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        windowStart: '10:00',
        windowEnd: '10:00',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid color hex', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        color: 'red',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with name exceeding max length', async () => {
    const res = await request(app)
      .post('/api/habits')
      .send({
        ...VALID_HABIT_BODY,
        name: 'x'.repeat(201),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 403 when free tier habit limit reached (3)', async () => {
    // First where call returns habit count = 3 (at limit)
    mockDb._setWhereResults([[{ count: 3 }]]);

    const res = await request(app).post('/api/habits').send(VALID_HABIT_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxHabits');
    expect(res.body.current).toBe(3);
    expect(res.body.max).toBe(3);
  });
});

// ─── PUT /api/habits/:id ──────────────────────────────────────────

describe('PUT /api/habits/:id', () => {
  beforeEach(resetMocks);

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).put(`/api/habits/${OTHER_UUID}`).send({ name: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Habit not found');
  });

  it('updates a habit with valid body', async () => {
    const existing = createMockHabit();
    const updated = createMockHabit({ name: 'Evening Run' });

    mockDb._setWhereResults([[existing]]);
    mockDb._mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(app).put(`/api/habits/${VALID_UUID}`).send({ name: 'Evening Run' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Evening Run');
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).put('/api/habits/not-a-uuid').send({ name: 'Updated' });

    expect(res.status).toBe(400);
  });

  it('returns 400 with invalid update fields', async () => {
    const existing = createMockHabit();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).put(`/api/habits/${VALID_UUID}`).send({ priority: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('updates multiple fields at once', async () => {
    const existing = createMockHabit();
    const updated = createMockHabit({
      name: 'Evening Meditation',
      priority: 1,
      days: ['mon', 'wed', 'fri'],
      enabled: false,
    });

    mockDb._setWhereResults([[existing]]);
    mockDb._mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(app)
      .put(`/api/habits/${VALID_UUID}`)
      .send({
        name: 'Evening Meditation',
        priority: 1,
        days: ['mon', 'wed', 'fri'],
        enabled: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Evening Meditation');
    expect(res.body.days).toEqual(['mon', 'wed', 'fri']);
  });
});

// ─── DELETE /api/habits/:id ───────────────────────────────────────

describe('DELETE /api/habits/:id', () => {
  beforeEach(resetMocks);

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).delete(`/api/habits/${OTHER_UUID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Habit not found');
  });

  it('deletes an existing habit', async () => {
    const existing = createMockHabit();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).delete(`/api/habits/${VALID_UUID}`);

    expect(res.status).toBe(204);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).delete('/api/habits/not-a-uuid');

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/habits/:id/force ───────────────────────────────────

describe('POST /api/habits/:id/force', () => {
  beforeEach(resetMocks);

  it('toggles forced to true', async () => {
    const existing = createMockHabit({ forced: false });
    const updated = createMockHabit({ forced: true });

    mockDb._setWhereResults([[existing]]);
    mockDb._mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(app).post(`/api/habits/${VALID_UUID}/force`).send({ forced: true });

    expect(res.status).toBe(200);
    expect(res.body.forced).toBe(true);
  });

  it('toggles forced to false', async () => {
    const existing = createMockHabit({ forced: true });
    const updated = createMockHabit({ forced: false });

    mockDb._setWhereResults([[existing]]);
    mockDb._mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(app).post(`/api/habits/${VALID_UUID}/force`).send({ forced: false });

    expect(res.status).toBe(200);
    expect(res.body.forced).toBe(false);
  });

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).post(`/api/habits/${OTHER_UUID}/force`).send({ forced: true });

    expect(res.status).toBe(404);
  });

  it('returns 400 with missing forced field', async () => {
    const existing = createMockHabit();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).post(`/api/habits/${VALID_UUID}/force`).send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 with non-boolean forced value', async () => {
    const existing = createMockHabit();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).post(`/api/habits/${VALID_UUID}/force`).send({ forced: 'yes' });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/habits/:id/completions ─────────────────────────────

describe('POST /api/habits/:id/completions', () => {
  beforeEach(resetMocks);

  it('records a completion with valid date', async () => {
    const existing = createMockHabit();
    const completionRow = {
      id: 'c0000000-0000-0000-0000-000000000001',
      userId: TEST_USER_ID,
      habitId: VALID_UUID,
      scheduledDate: '2026-03-20',
      completedAt: '2026-03-20T12:00:00.000Z',
    };

    mockDb._setWhereResults([[existing]]);
    mockDb._mockReturning.mockResolvedValueOnce([completionRow]);

    const res = await request(app)
      .post(`/api/habits/${VALID_UUID}/completions`)
      .send({ scheduledDate: '2026-03-20' });

    expect(res.status).toBe(201);
    expect(res.body.habitId).toBe(VALID_UUID);
    expect(res.body.scheduledDate).toBe('2026-03-20');
    expect(res.body.completedAt).toBeDefined();
  });

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app)
      .post(`/api/habits/${OTHER_UUID}/completions`)
      .send({ scheduledDate: '2026-03-20' });

    expect(res.status).toBe(404);
  });

  it('returns 400 with invalid date format', async () => {
    const existing = createMockHabit();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app)
      .post(`/api/habits/${VALID_UUID}/completions`)
      .send({ scheduledDate: '2026/03/20' });

    expect(res.status).toBe(400);
  });

  it('returns 400 with missing scheduledDate', async () => {
    const existing = createMockHabit();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).post(`/api/habits/${VALID_UUID}/completions`).send({});

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/habits/:id/completions ──────────────────────────────

describe('GET /api/habits/:id/completions', () => {
  beforeEach(resetMocks);

  it('returns completions for a habit', async () => {
    const existing = createMockHabit();
    const completions = [
      {
        id: 'c1',
        userId: TEST_USER_ID,
        habitId: VALID_UUID,
        scheduledDate: '2026-03-20',
        completedAt: '2026-03-20T12:00:00.000Z',
      },
    ];

    // First where: habit lookup, second where: completions query
    mockDb._setWhereResults([[existing], completions]);

    const res = await request(app).get(`/api/habits/${VALID_UUID}/completions`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).get(`/api/habits/${OTHER_UUID}/completions`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).get('/api/habits/not-a-uuid/completions');

    expect(res.status).toBe(400);
  });
});
