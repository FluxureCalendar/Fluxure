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

  const mockExecute = vi.fn().mockResolvedValue([]);

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    execute: mockExecute,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callback
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        insert: vi.fn().mockReturnValue({ values: mockValues }),
        update: vi.fn().mockReturnValue({ set: mockSet }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
        execute: mockExecute,
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
    _mockExecute: mockExecute,
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
vi.mock('../auth/email.js', () => ({
  sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cache/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
  getSubscriberClient: vi.fn().mockReturnValue(null),
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cache/user-settings.js', () => ({
  getUserSettingsCached: vi.fn().mockResolvedValue({
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
    trimCompletedEvents: true,
    pastEventRetentionDays: 7,
  }),
}));
vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
  bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createTestApp } from './helpers.js';
import bookingRouter from '../routes/booking.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

const app = createTestApp('book', bookingRouter);

function makeLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000050',
    userId: 'test-user-id',
    slug: 'test-link',
    name: 'Test Booking',
    enabled: true,
    durations: [15, 30, 60],
    schedulingHours: 'working',
    windowStart: null,
    windowEnd: null,
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
  mockDb._mockExecute.mockResolvedValue([]);
}

describe('GET /api/book/:slug (link info)', () => {
  beforeEach(resetMocks);

  it('returns link info for valid slug', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const res = await request(app).get('/api/book/test-link');

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('test-link');
    expect(res.body.name).toBe('Test Booking');
    expect(res.body.durations).toEqual([15, 30, 60]);
  });

  it('returns 404 for non-existent slug', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).get('/api/book/no-such-link');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('returns 404 for disabled link', async () => {
    const link = makeLinkRow({ enabled: false });
    mockDb._setWhereResults([[link]]);

    const res = await request(app).get('/api/book/test-link');

    expect(res.status).toBe(404);
  });

  it('returns 404 for invalid slug format (special characters)', async () => {
    const res = await request(app).get('/api/book/INVALID_SLUG!@#');

    expect(res.status).toBe(404);
  });

  it('returns 404 for slug exceeding max length', async () => {
    const longSlug = 'a'.repeat(101);
    const res = await request(app).get(`/api/book/${longSlug}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/book/:slug/availability', () => {
  beforeEach(resetMocks);

  it('returns available slots for valid request', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([
      [link], // link lookup
      [], // managed events
      [], // enabled calendars
      [{ plan: 'free' }], // owner plan
    ]);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=30`,
    );

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('test-link');
    expect(res.body.date).toBe(dateStr);
    expect(res.body.duration).toBe(30);
    expect(Array.isArray(res.body.slots)).toBe(true);
  });

  it('returns 404 for non-existent slug', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).get(
      '/api/book/no-link/availability?date=2026-04-01&duration=30',
    );

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid duration not in configured list', async () => {
    const link = makeLinkRow({ durations: [15, 30] });
    mockDb._setWhereResults([[link]]);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=45`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid duration');
  });

  it('returns 400 for date too far in the future', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);
    const dateStr = farFuture.toISOString().split('T')[0];

    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=30`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('14 days');
  });
});

describe('POST /api/book/:slug', () => {
  beforeEach(resetMocks);

  it('creates a booking with valid data', async () => {
    const link = makeLinkRow();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow);
    start.setUTCHours(14, 0, 0, 0); // 14:00 UTC = 10:00 AM ET
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const insertedEvent = {
      id: '00000000-0000-0000-0000-000000000060',
      userId: 'test-user-id',
      itemType: 'meeting',
      itemId: link.id,
      title: 'Booking: John Doe',
      start: start.toISOString(),
      end: end.toISOString(),
      status: 'busy',
    };

    mockDb._setWhereResults([[link], [], [], [{ name: 'Host User' }]]);
    mockDb._mockReturning.mockResolvedValueOnce([insertedEvent]);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: 'John Doe',
      email: 'john@example.com',
    });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('test-link');
    expect(res.body.name).toBe('John Doe');
    expect(res.body.duration).toBe(30);
  });

  it('returns 404 for non-existent slug', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).post('/api/book/no-link').send({
      start: '2026-04-01T14:00:00.000Z',
      end: '2026-04-01T14:30:00.000Z',
      name: 'John Doe',
      email: 'john@example.com',
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 for start time in the past', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const past = new Date(Date.now() - 60 * 60 * 1000);
    const pastEnd = new Date(past.getTime() + 30 * 60 * 1000);

    const res = await request(app).post('/api/book/test-link').send({
      start: past.toISOString(),
      end: pastEnd.toISOString(),
      name: 'John Doe',
      email: 'john@example.com',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('future');
  });

  it('returns 400 for invalid email', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const res = await request(app).post('/api/book/test-link').send({
      start: '2026-04-01T14:00:00.000Z',
      end: '2026-04-01T14:30:00.000Z',
      name: 'John Doe',
      email: 'not-an-email',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing required fields', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const res = await request(app).post('/api/book/test-link').send({
      start: '2026-04-01T14:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid duration not in configured durations', async () => {
    const link = makeLinkRow({ durations: [15, 30] });
    mockDb._setWhereResults([[link]]);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow);
    start.setUTCHours(14, 0, 0, 0);
    const end = new Date(start.getTime() + 45 * 60 * 1000);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: 'John Doe',
      email: 'john@example.com',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid duration');
  });

  it('strips HTML tags from name and notes', async () => {
    const link = makeLinkRow();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow);
    start.setUTCHours(14, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const insertedEvent = {
      id: 'ev-1',
      userId: 'test-user-id',
      itemType: 'meeting',
      title: 'Booking: John Doe',
      start: start.toISOString(),
      end: end.toISOString(),
    };

    mockDb._setWhereResults([[link], [], []]);
    mockDb._mockReturning.mockResolvedValueOnce([insertedEvent]);
    mockDb._setWhereResults([[{ name: 'Host' }]]);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: '<script>alert("xss")</script>John Doe',
      email: 'john@example.com',
      notes: '<b>Important</b> meeting',
    });

    if (res.status === 201) {
      expect(res.body.name).not.toContain('<script>');
    }
  });
});
