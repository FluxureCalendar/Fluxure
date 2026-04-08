import { vi } from 'vitest';
import express from 'express';

// ── Constants ────────────────────────────────────────────────

export const TEST_API_KEY = 'test-api-key-12345';
export const TEST_USER_ID = 'test-user-id';
export const TEST_USER_EMAIL = 'test@example.com';
export const TEST_UUID_1 = '00000000-0000-0000-0000-000000000001';
export const TEST_UUID_2 = '00000000-0000-0000-0000-000000000002';
export const TEST_UUID_3 = '00000000-0000-0000-0000-000000000003';
export const TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z';

// ── Express App Helpers ──────────────────────────────────────

/**
 * Creates a minimal Express app with JSON parsing and auth middleware,
 * mounting the given router at /api/<prefix>.
 * The auth middleware injects req.userId, req.userEmail, and req.userPlan
 * for all requests under /api.
 */
export function createTestApp(prefix: string, router: express.Router): express.Express {
  const app = express();
  app.use(express.json());

  app.use('/api', (req, _res, next) => {
    req.userId = TEST_USER_ID;
    req.userEmail = TEST_USER_EMAIL;
    req.userPlan = 'free';
    next();
  });

  app.use(`/api/${prefix}`, router);
  return app;
}

/**
 * Creates a test app with a specific plan injected into auth middleware.
 * Useful for testing plan-gated routes (free vs pro behavior).
 */
export function createTestAppWithPlan(
  prefix: string,
  router: express.Router,
  plan: 'free' | 'pro',
): express.Express {
  const app = express();
  app.use(express.json());

  app.use('/api', (req, _res, next) => {
    req.userId = TEST_USER_ID;
    req.userEmail = TEST_USER_EMAIL;
    req.userPlan = plan;
    next();
  });

  app.use(`/api/${prefix}`, router);
  return app;
}

/** Returns an Authorization header with the test API key. */
export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_API_KEY}` };
}

// ── Mock Database ────────────────────────────────────────────

/**
 * Shape of the mock database returned by `createMockDb()`.
 * Exposes both the Drizzle-like API surface (select, insert, update, delete, transaction)
 * and internal mock references prefixed with `_mock` for test assertions and configuration.
 */
export interface MockDb {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
  _mockWhere: ReturnType<typeof vi.fn>;
  _mockFrom: ReturnType<typeof vi.fn>;
  _mockValues: ReturnType<typeof vi.fn>;
  _mockReturning: ReturnType<typeof vi.fn>;
  _mockSet: ReturnType<typeof vi.fn>;
  _mockWhereReturning: ReturnType<typeof vi.fn>;
  _mockDeleteWhere: ReturnType<typeof vi.fn>;
  _mockLimit: ReturnType<typeof vi.fn>;
  _mockOffset: ReturnType<typeof vi.fn>;
  _mockOrderBy: ReturnType<typeof vi.fn>;
  /**
   * Configure sequential where() results. Each call to where() will consume
   * the next array in the list. After all are consumed, returns [].
   */
  _setWhereResults: (results: unknown[][]) => void;
}

/**
 * Creates a comprehensive mock of the Drizzle ORM database object.
 * This replicates the chaining API: db.select().from().where().limit().offset()
 * and db.insert().values().returning(), db.update().set().where().returning(), etc.
 *
 * IMPORTANT: This must be called inside `vi.hoisted()` since it uses `vi.fn()`.
 *
 * @example
 * ```ts
 * const { mockDb } = vi.hoisted(() => {
 *   const mockDb = createMockDb();
 *   return { mockDb };
 * });
 * vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
 * ```
 */
export function createMockDb(): MockDb {
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

  mockOrderBy.mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  const mockDb: MockDb = {
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

  return mockDb;
}

/**
 * Resets all mock state on a MockDb instance to its initial configuration.
 * Call this in `beforeEach` to ensure test isolation.
 *
 * @example
 * ```ts
 * beforeEach(() => {
 *   vi.clearAllMocks();
 *   resetMockDb(mockDb);
 * });
 * ```
 */
export function resetMockDb(mockDb: MockDb): void {
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

/**
 * Creates a mock PostgreSQL connection pool.
 * Used for tests that need raw SQL (e.g., refresh token rotation).
 *
 * @example
 * ```ts
 * const { mockPool } = vi.hoisted(() => {
 *   const mockPool = createMockPool();
 *   return { mockPool };
 * });
 * vi.mock('../db/pg-index.js', () => ({ db: mockDb, pool: () => mockPool }));
 * ```
 */
export function createMockPool(): Record<string, unknown> {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(mockClient),
    _mockClient: mockClient,
  };
}

// ── Factory Functions ────────────────────────────────────────

/**
 * Creates a mock user row matching the `users` Drizzle schema shape.
 * All fields have sensible defaults; pass overrides to customize.
 */
export function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_1,
    email: TEST_USER_EMAIL,
    name: 'Test User',
    avatarUrl: null,
    emailVerified: true,
    googleId: null,
    passwordHash: '$2b$12$validhashplaceholder',
    plan: 'free',
    planPeriodEnd: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    billingInterval: null,
    paymentStatus: null,
    onboardingCompleted: true,
    googleRefreshToken: null,
    googleSyncToken: null,
    settings: null,
    gdprConsentAt: TEST_TIMESTAMP,
    consentVersion: '1.0',
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock session row matching the `sessions` Drizzle schema shape.
 */
export function createMockSession(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    userId: TEST_UUID_1,
    refreshTokenHash: 'abc123',
    userAgent: 'TestAgent/1.0',
    ipAddress: '192.168.1.*',
    createdAt: TEST_TIMESTAMP,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/**
 * Creates a mock calendar row matching the `calendars` Drizzle schema shape.
 */
export function createMockCalendar(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_2,
    userId: TEST_USER_ID,
    googleCalendarId: 'primary@gmail.com',
    name: 'Primary Calendar',
    color: '#4285f4',
    mode: 'writable',
    enabled: true,
    isPrimary: true,
    syncToken: null,
    watchChannelId: null,
    watchResourceId: null,
    watchToken: null,
    watchExpiresAt: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock habit row matching the `habits` Drizzle schema shape.
 */
export function createMockHabit(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_1,
    userId: TEST_USER_ID,
    name: 'Morning Run',
    priority: 2,
    windowStart: '06:00',
    windowEnd: '09:00',
    idealTime: '07:00',
    durationMin: 30,
    durationMax: 60,
    days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    schedulingHours: 'working',
    forced: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    skipBuffer: false,
    notifications: false,
    calendarId: null,
    color: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock task row matching the `tasks` Drizzle schema shape.
 */
export function createMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_1,
    userId: TEST_USER_ID,
    name: 'Write report',
    priority: 2,
    totalDuration: 120,
    remainingDuration: 120,
    dueDate: null,
    earliestStart: null,
    chunkMin: 15,
    chunkMax: 120,
    schedulingHours: null,
    status: 'open',
    isUpNext: false,
    skipBuffer: false,
    enabled: true,
    calendarId: null,
    color: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock scheduled event row matching the `scheduledEvents` Drizzle schema shape.
 */
export function createMockEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_1,
    userId: TEST_USER_ID,
    itemType: 'habit',
    itemId: TEST_UUID_2,
    title: 'Morning Run',
    googleEventId: null,
    calendarId: null,
    start: '2026-03-05T09:00:00Z',
    end: '2026-03-05T10:00:00Z',
    status: 'free',
    isAllDay: false,
    alternativeSlotsCount: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock smart meeting row matching the `smartMeetings` Drizzle schema shape.
 */
export function createMockMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_1,
    userId: TEST_USER_ID,
    name: 'Team Standup',
    priority: 2,
    attendees: null,
    duration: 30,
    frequency: 'daily',
    idealTime: '10:00',
    windowStart: '09:00',
    windowEnd: '12:00',
    location: null,
    conferenceType: null,
    skipBuffer: false,
    enabled: true,
    calendarId: null,
    color: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock scheduling link row matching the `schedulingLinks` Drizzle schema shape.
 */
export function createMockSchedulingLink(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000050',
    userId: TEST_USER_ID,
    slug: 'test-link',
    name: 'Test Booking',
    enabled: true,
    durations: [15, 30, 60],
    schedulingHours: 'working',
    priority: 3,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

// ── Default Settings ─────────────────────────────────────────

/** Default user settings object used across test files. */
export const DEFAULT_USER_SETTINGS = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: 'America/New_York',
  schedulingWindowDays: 14,
  trimCompletedEvents: true,
} as const;

// ── Common Mock Module Factories ─────────────────────────────
// These return mock module shapes for use with vi.mock().
// They cannot call vi.mock() directly because vi.mock() is hoisted
// and must appear at the top level of each test file.

/** Returns a mock shape for ../ws.js */
export function mockWsModule(): Record<string, unknown> {
  return {
    broadcastToUser: vi.fn(),
    broadcast: vi.fn(),
  };
}

/** Returns a mock shape for ../polling-ref.js */
export function mockPollingRefModule(): Record<string, unknown> {
  return {
    triggerReschedule: vi.fn(),
  };
}

/** Returns a mock shape for ../logger.js */
export function mockLoggerModule(): Record<string, unknown> {
  return {
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
}

/** Returns a mock shape for ../config.js with optional overrides. */
export function mockConfigModule(overrides: Record<string, unknown> = {}) {
  return {
    FRONTEND_URL: 'http://localhost:5173',
    allowedOrigins: ['http://localhost:5173'],
    INSTANCE_ID: 'test-instance',
    isSelfHosted: () => false,
    ...overrides,
  };
}

/** Returns a mock shape for ../cache/redis.js */
export function mockRedisModule(): Record<string, unknown> {
  return {
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
  };
}

/** Returns a mock shape for ../cache/user-settings.js with optional overrides. */
export function mockUserSettingsModule(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    getUserSettingsCached: vi.fn().mockResolvedValue({
      ...DEFAULT_USER_SETTINGS,
      ...overrides,
    }),
    getUserTimezoneCached: vi
      .fn()
      .mockResolvedValue((overrides.timezone as string) ?? DEFAULT_USER_SETTINGS.timezone),
  };
}

/** Returns a mock shape for ../scheduler-registry.js */
export function mockSchedulerRegistryModule(): Record<string, unknown> {
  return {
    schedulerRegistry: {
      getOrCreate: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue(undefined),
      cancelIdle: vi.fn(),
      scheduleIdle: vi.fn(),
    },
  };
}

/** Returns a mock shape for express-rate-limit (passthrough). */
export function mockRateLimitModule() {
  return {
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
}

/** Returns a mock shape for ../rate-limiters.js (passthrough). */
export function mockRateLimitersModule(): Record<string, unknown> {
  return {
    createStore: vi.fn().mockReturnValue(undefined),
    bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
}

// ── Date Helpers ─────────────────────────────────────────────

/** Returns an ISO string for a date N days from now. Positive = future, negative = past. */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Returns an ISO string for a date N hours from now. */
export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/** Returns tomorrow's date as a YYYY-MM-DD string. */
export function tomorrowDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
