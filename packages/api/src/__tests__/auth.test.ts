import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockDb, mockPool } = vi.hoisted(() => {
  // Env vars must be set in hoisted block so they are available before module imports
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars-long';
  process.env.EMAIL_PASSWORD_AUTH = 'true';

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

  // Pool mock for refresh token (raw SQL queries)
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    _mockClient: mockClient,
  };

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

  return { mockDb, mockPool };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb, pool: () => mockPool }));
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../auth/email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../google/index.js', () => ({
  createOAuth2Client: vi.fn(),
  GoogleCalendarClient: vi.fn(),
}));
vi.mock('../crypto.js', () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
}));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    getOrCreate: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
  },
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
vi.mock('../config.js', () => ({
  FRONTEND_URL: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173'],
  INSTANCE_ID: 'test-instance',
}));
vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
  bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../jobs/data-export.js', () => ({
  processDataExport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../jobs/queues.js', () => ({
  getDataExportQueue: vi.fn().mockReturnValue(null),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import authRouter from '../routes/auth.js';
import { hashPassword } from '../auth/password.js';
import { signAccessToken, hashToken } from '../auth/jwt.js';
import cookieParser from 'cookie-parser';

// Auth routes handle their own auth, so no pre-injected userId
function createAuthApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  return app;
}

const app = createAuthApp();

function makeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: null,
    emailVerified: true,
    googleId: null,
    passwordHash: '$2b$12$validhashplaceholder',
    plan: 'free',
    planPeriodEnd: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    onboardingCompleted: true,
    googleRefreshToken: null,
    gdprConsentAt: '2026-01-01T00:00:00.000Z',
    consentVersion: '1.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    userId: '00000000-0000-0000-0000-000000000001',
    refreshTokenHash: 'abc123',
    userAgent: 'TestAgent/1.0',
    ipAddress: '192.168.1.*',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
  mockPool._mockClient.query.mockResolvedValue({ rows: [] });
}

function makeAccessToken(
  userId = '00000000-0000-0000-0000-000000000001',
  overrides: Record<string, unknown> = {},
) {
  return signAccessToken({
    userId,
    email: 'test@example.com',
    plan: 'free',
    emailVerified: true,
    hasGdprConsent: true,
    gdprConsentVersion: '1.0',
    ...overrides,
  });
}

describe('POST /api/auth/signup', () => {
  beforeEach(resetMocks);

  it('creates a new user with valid input', async () => {
    const newUser = makeUserRow({ emailVerified: false });
    mockDb._setWhereResults([[], [{ count: 0 }], [newUser]]);
    mockDb._mockReturning.mockResolvedValueOnce([newUser]);

    const res = await request(app).post('/api/auth/signup').send({
      email: 'test@example.com',
      password: 'StrongPass123!',
      name: 'Test User',
      gdprConsent: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
  });

  it('returns 409 for duplicate email', async () => {
    const existing = makeUserRow();
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).post('/api/auth/signup').send({
      email: 'test@example.com',
      password: 'StrongPass123!',
      name: 'Test User',
      gdprConsent: true,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });

  it('returns 409 with GOOGLE_ACCOUNT code for Google-linked email', async () => {
    const existing = makeUserRow({ googleId: 'google-123' });
    mockDb._setWhereResults([[existing]]);

    const res = await request(app).post('/api/auth/signup').send({
      email: 'test@example.com',
      password: 'StrongPass123!',
      name: 'Test User',
      gdprConsent: true,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GOOGLE_ACCOUNT');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'not-an-email',
      password: 'StrongPass123!',
      name: 'Test User',
      gdprConsent: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for weak password (too short)', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'test@example.com',
      password: 'short',
      name: 'Test User',
      gdprConsent: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'test@example.com',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when GDPR consent is not provided', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email: 'test@example.com',
      password: 'StrongPass123!',
      name: 'Test User',
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(resetMocks);

  it('logs in with valid credentials', async () => {
    const hash = await hashPassword('CorrectPassword1!');
    const user = makeUserRow({ passwordHash: hash });
    mockDb._setWhereResults([[user], [{ count: 0 }], [user]]);

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'CorrectPassword1!',
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
  });

  it('returns 401 for wrong password', async () => {
    const hash = await hashPassword('CorrectPassword1!');
    const user = makeUserRow({ passwordHash: hash });
    mockDb._setWhereResults([[user]]);

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'WrongPassword1!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 401 for non-existent email', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'SomePassword1!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 409 for Google-only account', async () => {
    const user = makeUserRow({ passwordHash: null, googleId: 'google-123' });
    mockDb._setWhereResults([[user]]);

    const res = await request(app).post('/api/auth/login').send({
      email: 'test@example.com',
      password: 'SomePassword1!',
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GOOGLE_ACCOUNT');
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('POST /api/auth/logout', () => {
  beforeEach(resetMocks);

  it('logs out successfully with a refresh token cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refresh_token=some-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('succeeds even without a refresh token cookie', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(resetMocks);

  it('returns 401 when no refresh token cookie is present', async () => {
    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No refresh token');
  });

  it('returns 401 for invalid/expired refresh token', async () => {
    mockPool._mockClient.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=invalid-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or expired');
  });

  it('refreshes successfully with valid refresh token', async () => {
    const user = makeUserRow();
    mockPool._mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'session-1', user_id: user.id }],
      }) // SELECT FOR UPDATE
      .mockResolvedValueOnce(undefined) // DELETE old session
      .mockResolvedValueOnce(undefined); // COMMIT

    mockDb._setWhereResults([[user], [{ count: 0 }], [user]]);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=valid-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/auth/verify-email', () => {
  beforeEach(resetMocks);

  it('verifies email with valid token', async () => {
    const verification = {
      id: 'v1',
      userId: '00000000-0000-0000-0000-000000000001',
      tokenHash: hashToken('valid-token'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    mockDb._setWhereResults([[verification]]);

    const res = await request(app).get('/api/auth/verify-email?token=valid-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('verified');
  });

  it('returns 400 for expired/invalid token', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).get('/api/auth/verify-email?token=expired-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or expired');
  });

  it('returns 400 when token is missing', async () => {
    const res = await request(app).get('/api/auth/verify-email');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing verification token');
  });
});

describe('POST /api/auth/forgot-password', () => {
  beforeEach(resetMocks);

  it('returns success message for existing email', async () => {
    const user = makeUserRow();
    mockDb._setWhereResults([[user]]);

    const res = await request(app).post('/api/auth/forgot-password').send({
      email: 'test@example.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
  });

  it('returns success message even for non-existent email (no enumeration)', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(app).post('/api/auth/forgot-password').send({
      email: 'nobody@example.com',
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('reset link');
  });

  it('returns 400 for invalid email', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({
      email: 'not-email',
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  beforeEach(resetMocks);

  it('resets password with valid token', async () => {
    const resetRow = {
      id: 'r1',
      userId: '00000000-0000-0000-0000-000000000001',
      tokenHash: hashToken('valid-reset-token'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      usedAt: null,
    };
    mockDb._mockReturning.mockResolvedValueOnce([resetRow]);

    const res = await request(app).post('/api/auth/reset-password').send({
      token: 'valid-reset-token',
      password: 'NewStrongPass1!',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('reset successfully');
  });

  it('returns 400 for expired/used token', async () => {
    mockDb._mockReturning.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/auth/reset-password').send({
      token: 'expired-token',
      password: 'NewStrongPass1!',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or expired');
  });

  it('returns 400 for weak new password', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({
      token: 'some-token',
      password: 'short',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(resetMocks);

  it('returns user when authenticated', async () => {
    const user = makeUserRow();
    mockDb._setWhereResults([[user]]);
    const token = makeAccessToken();

    const res = await request(app).get('/api/auth/me').set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'access_token=invalid-jwt-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid or expired');
  });
});

describe('GET /api/auth/sessions', () => {
  beforeEach(resetMocks);

  it('returns list of sessions when authenticated', async () => {
    const session = makeSessionRow();
    mockDb._setWhereResults([[session]]);
    const token = makeAccessToken();

    const res = await request(app).get('/api/auth/sessions').set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toBeDefined();
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/sessions');

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/sessions/:id', () => {
  beforeEach(resetMocks);

  it('revokes a session', async () => {
    const session = makeSessionRow();
    mockDb._setWhereResults([[session]]);
    const token = makeAccessToken();

    const res = await request(app)
      .delete(`/api/auth/sessions/${session.id}`)
      .set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('revoked');
  });

  it('returns 404 for non-existent session', async () => {
    mockDb._setWhereResults([[]]);
    const token = makeAccessToken();

    const res = await request(app)
      .delete('/api/auth/sessions/00000000-0000-0000-0000-000000000099')
      .set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid session ID format', async () => {
    const token = makeAccessToken();

    const res = await request(app)
      .delete('/api/auth/sessions/not-a-uuid')
      .set('Cookie', `access_token=${token}`);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/change-password', () => {
  beforeEach(resetMocks);

  it('changes password with correct current password', async () => {
    const hash = await hashPassword('CurrentPass1!');
    const user = makeUserRow({ passwordHash: hash });
    mockDb._setWhereResults([[user]]);
    const token = makeAccessToken();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', `access_token=${token}`)
      .send({
        currentPassword: 'CurrentPass1!',
        newPassword: 'NewStrongPass1!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for incorrect current password', async () => {
    const hash = await hashPassword('CurrentPass1!');
    const user = makeUserRow({ passwordHash: hash });
    mockDb._setWhereResults([[user]]);
    const token = makeAccessToken();

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', `access_token=${token}`)
      .send({
        currentPassword: 'WrongCurrent1!',
        newPassword: 'NewStrongPass1!',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('incorrect');
  });
});
