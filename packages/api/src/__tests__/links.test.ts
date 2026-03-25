import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockSchedulingLink, TEST_USER_ID, TEST_UUID_1 } from './helpers.js';

// ── Inline mock DB (vi.hoisted requirement) ──────────────────
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
    (result as any).limit = mockLimit;
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
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        insert: vi.fn().mockReturnValue({ values: mockValues }),
        update: vi.fn().mockReturnValue({ set: mockSet }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
        execute: vi.fn().mockResolvedValue({ rows: [] }),
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
vi.mock('../cache/user-settings.js', () => ({
  getUserSettingsCached: vi.fn().mockResolvedValue({
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
    trimCompletedEvents: true,
  }),
  getUserTimezoneCached: vi.fn().mockResolvedValue('America/New_York'),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../routes/booking.js', () => ({
  invalidateBookingAvailability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/route-helpers.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/route-helpers.js')>(
    '../utils/route-helpers.js',
  );
  return actual;
});
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
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

import linksRouter from '../routes/links.js';

const app = createTestApp('links', linksRouter);

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

const VALID_LINK_BODY = {
  name: 'My Meeting',
  slug: 'my-meeting',
  durations: [15, 30],
};

const LINK_UUID = '00000000-0000-0000-0000-000000000050';

// ─── GET /api/links ──────────────────────────────────────────────

describe('GET /api/links', () => {
  beforeEach(resetMocks);

  it('returns empty list', async () => {
    // select().from().where() returns [], then .limit() and .offset()
    mockDb._setWhereResults([[]]);
    mockDb._mockLimit.mockReturnValue({ offset: vi.fn().mockResolvedValue([]) });

    const res = await request(app).get('/api/links');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns list of links', async () => {
    const link = createMockSchedulingLink();
    mockDb._setWhereResults([[link]]);
    mockDb._mockLimit.mockReturnValue({ offset: vi.fn().mockResolvedValue([link]) });

    const res = await request(app).get('/api/links');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe('test-link');
  });
});

// ─── POST /api/links ─────────────────────────────────────────────

describe('POST /api/links', () => {
  beforeEach(resetMocks);

  it('creates a link with valid body', async () => {
    const newLink = createMockSchedulingLink({
      slug: 'my-meeting',
      name: 'My Meeting',
      durations: [15, 30],
    });
    // 1st where: count query
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([newLink]);

    const res = await request(app).post('/api/links').send(VALID_LINK_BODY);
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-meeting');
    expect(res.body.name).toBe('My Meeting');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app).post('/api/links').send({ name: 'Missing slug' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid slug (uppercase)', async () => {
    const res = await request(app)
      .post('/api/links')
      .send({
        ...VALID_LINK_BODY,
        slug: 'Invalid-Slug',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for empty durations', async () => {
    const res = await request(app)
      .post('/api/links')
      .send({
        ...VALID_LINK_BODY,
        durations: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 409 for duplicate slug', async () => {
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockValues.mockReturnValue({
      returning: vi.fn().mockRejectedValue({ code: '23505' }),
    });

    const res = await request(app).post('/api/links').send(VALID_LINK_BODY);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Slug already exists');
  });

  it('returns 403 when plan limit reached', async () => {
    // Free plan maxSchedulingLinks = 1
    mockDb._setWhereResults([[{ count: 1 }]]);

    const res = await request(app).post('/api/links').send(VALID_LINK_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxSchedulingLinks');
  });
});

// ─── PUT /api/links/:id ──────────────────────────────────────────

describe('PUT /api/links/:id', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).put('/api/links/not-a-uuid').send({ name: 'Updated' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when link not found', async () => {
    mockDb._mockReturning.mockResolvedValueOnce([]);

    const res = await request(app).put(`/api/links/${LINK_UUID}`).send({ name: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('updates a link', async () => {
    const updated = createMockSchedulingLink({ name: 'Updated Meeting' });
    mockDb._mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(app).put(`/api/links/${LINK_UUID}`).send({ name: 'Updated Meeting' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Meeting');
  });

  it('returns 409 for duplicate slug on update', async () => {
    mockDb._mockWhereReturning.mockReturnValue({
      returning: vi.fn().mockRejectedValue({ code: '23505' }),
    });
    mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
    mockDb.update.mockReturnValue({ set: mockDb._mockSet });

    const res = await request(app).put(`/api/links/${LINK_UUID}`).send({ slug: 'taken-slug' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Slug already exists');
  });
});

// ─── DELETE /api/links/:id ───────────────────────────────────────

describe('DELETE /api/links/:id', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).delete('/api/links/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 when link not found', async () => {
    mockDb._mockDeleteWhere.mockResolvedValue({ returning: vi.fn().mockResolvedValue([]) });
    // The delete path uses .delete().where().returning()
    mockDb._mockDeleteWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });

    const res = await request(app).delete(`/api/links/${LINK_UUID}`);
    expect(res.status).toBe(404);
  });

  it('deletes a link', async () => {
    const link = createMockSchedulingLink({ id: LINK_UUID });
    mockDb._mockDeleteWhere.mockReturnValue({
      returning: vi.fn().mockResolvedValue([link]),
    });
    mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });

    const res = await request(app).delete(`/api/links/${LINK_UUID}`);
    expect(res.status).toBe(204);
  });
});
