import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, TEST_USER_ID, TEST_UUID_1 } from './helpers.js';

const { mockDb } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockDeleteReturning = vi.fn().mockResolvedValue([]);
  const mockDeleteWhere = vi.fn().mockReturnValue({ returning: mockDeleteReturning });

  let whereResults: unknown[][] = [[]];
  let whereCallIndex = 0;
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    (result as any).limit = mockLimit;
    (result as any).orderBy = vi.fn().mockReturnValue(Promise.resolve(data));
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

  const mockFrom = vi.fn().mockReturnValue({
    where: mockWhere,
    orderBy: vi.fn().mockResolvedValue([]),
  });

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
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
    _mockDeleteReturning: mockDeleteReturning,
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
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../config.js', () => ({
  FRONTEND_URL: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173'],
  INSTANCE_ID: 'test-instance',
  isSelfHosted: () => false,
}));
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
  bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import templatesRouter from '../routes/scheduling-templates.js';

const app = createTestApp('scheduling-templates', templatesRouter);

const MOCK_TEMPLATE = {
  id: TEST_UUID_1,
  userId: TEST_USER_ID,
  name: 'Early Morning',
  startTime: '06:00',
  endTime: '09:00',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockDeleteReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({
    where: mockDb._mockWhere,
    orderBy: vi.fn().mockResolvedValue([]),
  });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockReturnValue({ returning: mockDb._mockDeleteReturning });
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

// ─── GET /api/scheduling-templates ───────────────────────────────

describe('GET /api/scheduling-templates', () => {
  beforeEach(resetMocks);

  it('returns empty list when no templates exist', async () => {
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
      orderBy: vi.fn().mockResolvedValue([]),
    });

    const res = await request(app).get('/api/scheduling-templates');

    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([]);
  });

  it('returns list of templates', async () => {
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([MOCK_TEMPLATE]),
      }),
      orderBy: vi.fn().mockResolvedValue([MOCK_TEMPLATE]),
    });

    const res = await request(app).get('/api/scheduling-templates');

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(res.body.templates[0].name).toBe('Early Morning');
  });
});

// ─── POST /api/scheduling-templates ──────────────────────────────

describe('POST /api/scheduling-templates', () => {
  beforeEach(resetMocks);

  it('creates a template with valid data', async () => {
    // First where: existing templates count (empty = under limit)
    mockDb._setWhereResults([[]]);
    mockDb._mockReturning.mockResolvedValueOnce([MOCK_TEMPLATE]);

    const res = await request(app)
      .post('/api/scheduling-templates')
      .send({ name: 'Early Morning', startTime: '06:00', endTime: '09:00' });

    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe('Early Morning');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns 400 for invalid data (missing name)', async () => {
    const res = await request(app)
      .post('/api/scheduling-templates')
      .send({ startTime: '06:00', endTime: '09:00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid time format', async () => {
    const res = await request(app)
      .post('/api/scheduling-templates')
      .send({ name: 'Bad', startTime: '25:00', endTime: '09:00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('enforces max template limit (free plan = 2)', async () => {
    // Return 2 existing templates (at limit for free plan)
    const existingTemplates = [MOCK_TEMPLATE, { ...MOCK_TEMPLATE, id: 'id-2', name: 'Afternoon' }];
    mockDb._setWhereResults([existingTemplates]);

    const res = await request(app)
      .post('/api/scheduling-templates')
      .send({ name: 'Evening', startTime: '18:00', endTime: '22:00' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxTemplates');
  });

  it('returns 409 on duplicate name', async () => {
    mockDb._setWhereResults([[]]);
    const pgError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "idx_scheduling_templates_user_name"',
      ),
      { code: '23505' },
    );
    mockDb._mockValues.mockImplementationOnce(() => ({
      returning: vi.fn().mockRejectedValue(pgError),
    }));

    const res = await request(app)
      .post('/api/scheduling-templates')
      .send({ name: 'Early Morning', startTime: '06:00', endTime: '09:00' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });
});

// ─── DELETE /api/scheduling-templates/:id ────────────────────────

describe('DELETE /api/scheduling-templates/:id', () => {
  beforeEach(resetMocks);

  it('deletes an existing template', async () => {
    mockDb._mockDeleteReturning.mockResolvedValueOnce([MOCK_TEMPLATE]);

    const res = await request(app).delete(`/api/scheduling-templates/${TEST_UUID_1}`);

    expect(res.status).toBe(204);
  });

  it('returns 404 for non-existent template', async () => {
    mockDb._mockDeleteReturning.mockResolvedValueOnce([]);

    const res = await request(app).delete(`/api/scheduling-templates/${TEST_UUID_1}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Template not found');
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).delete('/api/scheduling-templates/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid ID format');
  });
});
