import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

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

import { createTestApp } from './helpers.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import habitsRouter from '../routes/habits.js';

const app = createTestApp('habits', habitsRouter);

function makeHabitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Morning Run',
    priority: 2,
    windowStart: '06:00',
    windowEnd: '09:00',
    idealTime: '07:00',
    durationMin: 30,
    durationMax: 60,
    frequency: 'daily',
    frequencyConfig: null,
    schedulingHours: 'working',
    forced: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    skipBuffer: false,
    notifications: false,
    calendarId: null,
    color: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

describe('GET /api/habits', () => {
  beforeEach(resetMocks);

  it('returns empty list when no habits exist', async () => {
    mockDb._setWhereResults([[]]);
    const res = await request(app).get('/api/habits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns list of habits', async () => {
    const row = makeHabitRow();
    mockDb._setWhereResults([[row]]);

    const res = await request(app).get('/api/habits');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Morning Run');
    expect(res.body[0].frequency).toBe('daily');
  });
});

describe('POST /api/habits', () => {
  beforeEach(resetMocks);

  it('creates a habit with valid body', async () => {
    const newHabit = makeHabitRow({ id: 'new-id' });
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([newHabit]);

    const res = await request(app).post('/api/habits').send({
      name: 'Morning Run',
      windowStart: '06:00',
      windowEnd: '09:00',
      idealTime: '07:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Morning Run');
  });

  it('returns 400 with missing required fields', async () => {
    const res = await request(app).post('/api/habits').send({ name: 'Missing fields' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid frequency', async () => {
    const res = await request(app).post('/api/habits').send({
      name: 'Bad Habit',
      windowStart: '06:00',
      windowEnd: '09:00',
      idealTime: '07:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'never',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid priority (out of range)', async () => {
    const res = await request(app).post('/api/habits').send({
      name: 'Bad Priority',
      windowStart: '06:00',
      windowEnd: '09:00',
      idealTime: '07:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
      priority: 10,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid time format', async () => {
    const res = await request(app).post('/api/habits').send({
      name: 'Bad Time',
      windowStart: '25:00',
      windowEnd: '09:00',
      idealTime: '07:00',
      durationMin: 30,
      durationMax: 60,
      frequency: 'daily',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('PUT /api/habits/:id', () => {
  beforeEach(resetMocks);

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app)
      .put('/api/habits/00000000-0000-0000-0000-000000000099')
      .send({ name: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Habit not found');
  });

  it('updates a habit with valid body', async () => {
    const existing = makeHabitRow();
    const updated = makeHabitRow({ name: 'Evening Run' });

    mockDb._setWhereResults([[existing]]);
    mockDb._mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(app)
      .put('/api/habits/00000000-0000-0000-0000-000000000001')
      .send({ name: 'Evening Run' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Evening Run');
  });
});

describe('DELETE /api/habits/:id', () => {
  beforeEach(resetMocks);

  it('returns 404 for non-existent habit', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).delete('/api/habits/00000000-0000-0000-0000-000000000099');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Habit not found');
  });

  it('deletes an existing habit', async () => {
    const existing = makeHabitRow();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).delete('/api/habits/00000000-0000-0000-0000-000000000001');

    expect(res.status).toBe(204);
  });
});
