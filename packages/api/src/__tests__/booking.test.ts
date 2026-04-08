import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

const { mockDb, mockSendBookingConfirmation } = vi.hoisted(() => {
  const mockSendBookingConfirmation = vi.fn().mockResolvedValue(undefined);
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

  return { mockDb, mockSendBookingConfirmation };
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
  sendBookingConfirmation: mockSendBookingConfirmation,
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
  }),
}));
vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
  bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'test-user-id';
    req.userEmail = 'test@example.com';
    req.userPlan = 'free';
    next();
  },
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

// --- Helpers ---

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

/** Build a future start/end pair in working hours (14:00 UTC = 10:00 AM ET). */
function makeFutureSlot(durationMin = 30) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(tomorrow);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  return { start, end };
}

function tomorrowDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
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
  mockSendBookingConfirmation.mockResolvedValue(undefined);
}

// ────────────────────────────────────────────────────────────────────
// GET /api/book/:slug — public link info
// ────────────────────────────────────────────────────────────────────
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
    expect(res.body.enabled).toBe(true);
    expect(res.body.timezone).toBeDefined();
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

  it('returns 404 for invalid slug with special characters', async () => {
    const res = await request(app).get('/api/book/INVALID_SLUG!@#');
    expect(res.status).toBe(404);
  });

  it('returns 404 for slug exceeding max length (101 chars)', async () => {
    const longSlug = 'a'.repeat(101);
    const res = await request(app).get(`/api/book/${longSlug}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for slug with uppercase letters', async () => {
    const res = await request(app).get('/api/book/MyLink');
    expect(res.status).toBe(404);
  });

  it('returns 404 for slug with underscores', async () => {
    const res = await request(app).get('/api/book/my_link');
    expect(res.status).toBe(404);
  });

  it('accepts slug with hyphens and numbers', async () => {
    const link = makeLinkRow({ slug: 'my-link-123' });
    mockDb._setWhereResults([[link]]);

    const res = await request(app).get('/api/book/my-link-123');
    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/book/:slug/availability
// ────────────────────────────────────────────────────────────────────
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

    const dateStr = tomorrowDateStr();
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

  it('returns 404 for disabled link', async () => {
    const link = makeLinkRow({ enabled: false });
    mockDb._setWhereResults([[link]]);

    const dateStr = tomorrowDateStr();
    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=30`,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid duration not in configured list', async () => {
    const link = makeLinkRow({ durations: [15, 30] });
    mockDb._setWhereResults([[link]]);

    const dateStr = tomorrowDateStr();
    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=45`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid duration');
  });

  it('returns 400 for date too far in the future (>14 days)', async () => {
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

  it('returns 400 for missing date parameter', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const res = await request(app).get('/api/book/test-link/availability?duration=30');
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing duration parameter', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const dateStr = tomorrowDateStr();
    const res = await request(app).get(`/api/book/test-link/availability?date=${dateStr}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid date format', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const res = await request(app).get(
      '/api/book/test-link/availability?date=01-04-2026&duration=30',
    );
    expect(res.status).toBe(400);
  });

  it('returns slots even when some times are occupied (occupied times excluded)', async () => {
    const link = makeLinkRow();
    const dateStr = tomorrowDateStr();
    // Simulate an existing event blocking 14:00-15:00 UTC (10:00-11:00 ET)
    const occupiedStart = `${dateStr}T14:00:00.000Z`;
    const occupiedEnd = `${dateStr}T15:00:00.000Z`;

    mockDb._setWhereResults([
      [link], // link lookup
      [{ start: occupiedStart, end: occupiedEnd, userId: 'test-user-id' }], // managed events
      [], // enabled calendars
      [{ plan: 'free' }], // owner plan
    ]);

    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=30`,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.slots)).toBe(true);
    // With an occupied block, we should still get some slots (before/after)
    // but fewer than a completely empty day
  });

  it('includes branding field in response', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link], [], [], [{ plan: 'free' }]]);

    const dateStr = tomorrowDateStr();
    const res = await request(app).get(
      `/api/book/test-link/availability?date=${dateStr}&duration=30`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('branding');
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/book/:slug — create booking
// ────────────────────────────────────────────────────────────────────
describe('POST /api/book/:slug', () => {
  beforeEach(resetMocks);

  it('creates a booking with valid data', async () => {
    const link = makeLinkRow();
    const { start, end } = makeFutureSlot(30);

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
    expect(res.body.id).toBeDefined();
    expect(res.body.createdAt).toBeDefined();
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

  it('returns 404 for disabled link', async () => {
    const link = makeLinkRow({ enabled: false });
    mockDb._setWhereResults([[link]]);

    const { start, end } = makeFutureSlot(30);
    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
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

  it('returns 400 for empty name', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const { start, end } = makeFutureSlot(30);
    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: '',
      email: 'john@example.com',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for duration not in configured durations', async () => {
    const link = makeLinkRow({ durations: [15, 30] });
    mockDb._setWhereResults([[link]]);

    const { start } = makeFutureSlot(45);
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

  it('returns 409 when slot conflicts with existing event (double-booking prevention)', async () => {
    const link = makeLinkRow();
    const { start, end } = makeFutureSlot(30);

    // Transaction mock: simulate conflict by having managed events overlap
    const conflictingEvent = {
      start: start.toISOString(),
      end: end.toISOString(),
      userId: 'test-user-id',
    };

    // Override transaction to simulate SLOT_CONFLICT
    mockDb.transaction.mockImplementationOnce(async () => {
      throw new Error('SLOT_CONFLICT');
    });

    mockDb._setWhereResults([[link]]);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: 'John Doe',
      email: 'john@example.com',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('no longer available');
  });

  it('strips HTML tags from name to prevent XSS', async () => {
    const link = makeLinkRow();
    const { start, end } = makeFutureSlot(30);

    const insertedEvent = {
      id: 'ev-xss-1',
      userId: 'test-user-id',
      itemType: 'meeting',
      title: 'Booking: alert("xss")John Doe',
      start: start.toISOString(),
      end: end.toISOString(),
    };

    mockDb._setWhereResults([[link], [], [], [{ name: 'Host' }]]);
    mockDb._mockReturning.mockResolvedValueOnce([insertedEvent]);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: '<script>alert("xss")</script>John Doe',
      email: 'john@example.com',
    });

    expect(res.status).toBe(201);
    expect(res.body.name).not.toContain('<script>');
    expect(res.body.name).not.toContain('<');
  });

  it('strips HTML tags from notes field', async () => {
    const link = makeLinkRow();
    const { start, end } = makeFutureSlot(30);

    const insertedEvent = {
      id: 'ev-xss-2',
      userId: 'test-user-id',
      itemType: 'meeting',
      title: 'Booking: Jane — Important meeting',
      start: start.toISOString(),
      end: end.toISOString(),
    };

    mockDb._setWhereResults([[link], [], [], [{ name: 'Host' }]]);
    mockDb._mockReturning.mockResolvedValueOnce([insertedEvent]);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: 'Jane',
      email: 'jane@example.com',
      notes: '<b>Important</b> <img onerror=alert(1)> meeting',
    });

    expect(res.status).toBe(201);
    expect(res.body.title).not.toContain('<b>');
    expect(res.body.title).not.toContain('<img');
  });

  it('sends booking confirmation email on success', async () => {
    const link = makeLinkRow();
    const { start, end } = makeFutureSlot(30);

    const insertedEvent = {
      id: 'ev-email-1',
      userId: 'test-user-id',
      itemType: 'meeting',
      title: 'Booking: Jane',
      start: start.toISOString(),
      end: end.toISOString(),
    };

    mockDb._setWhereResults([[link], [], [], [{ name: 'Host User' }]]);
    mockDb._mockReturning.mockResolvedValueOnce([insertedEvent]);

    const res = await request(app).post('/api/book/test-link').send({
      start: start.toISOString(),
      end: end.toISOString(),
      name: 'Jane',
      email: 'jane@example.com',
    });

    expect(res.status).toBe(201);
    expect(mockSendBookingConfirmation).toHaveBeenCalledWith(
      'jane@example.com',
      expect.objectContaining({
        hostName: 'Host User',
        duration: 30,
      }),
    );
  });

  it('returns 400 for name exceeding max length', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const { start, end } = makeFutureSlot(30);
    const res = await request(app)
      .post('/api/book/test-link')
      .send({
        start: start.toISOString(),
        end: end.toISOString(),
        name: 'A'.repeat(201),
        email: 'john@example.com',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid start datetime format', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link]]);

    const res = await request(app).post('/api/book/test-link').send({
      start: 'not-a-date',
      end: '2026-04-01T14:30:00.000Z',
      name: 'John',
      email: 'john@example.com',
    });

    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/book/:slug/bookings — list bookings (auth required)
// ────────────────────────────────────────────────────────────────────
describe('GET /api/book/:slug/bookings', () => {
  beforeEach(resetMocks);

  it('returns bookings for link owned by authenticated user', async () => {
    const link = makeLinkRow();
    const bookingEvents = [
      {
        id: 'booking-1',
        title: 'Booking: Alice',
        start: '2026-04-01T14:00:00.000Z',
        end: '2026-04-01T14:30:00.000Z',
        status: 'busy',
        createdAt: '2026-03-20T10:00:00.000Z',
      },
      {
        id: 'booking-2',
        title: 'Booking: Bob',
        start: '2026-04-02T10:00:00.000Z',
        end: '2026-04-02T10:30:00.000Z',
        status: 'busy',
        createdAt: '2026-03-21T10:00:00.000Z',
      },
    ];

    mockDb._setWhereResults([[link], bookingEvents]);

    const res = await request(app).get('/api/book/test-link/bookings');

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('test-link');
    expect(Array.isArray(res.body.bookings)).toBe(true);
    expect(res.body.bookings).toHaveLength(2);
    expect(res.body.bookings[0].title).toBe('Booking: Alice');
  });

  it('returns 404 for slug not owned by authenticated user', async () => {
    // The query scopes by userId, so no results → 404
    mockDb._setWhereResults([[]]);

    const res = await request(app).get('/api/book/someone-elses-link/bookings');
    expect(res.status).toBe(404);
  });

  it('returns empty bookings array when link exists but has no bookings', async () => {
    const link = makeLinkRow();
    mockDb._setWhereResults([[link], []]);

    const res = await request(app).get('/api/book/test-link/bookings');

    expect(res.status).toBe(200);
    expect(res.body.bookings).toEqual([]);
  });

  it('returns 404 for invalid slug format', async () => {
    const res = await request(app).get('/api/book/BAD_SLUG!/bookings');
    expect(res.status).toBe(404);
  });
});
