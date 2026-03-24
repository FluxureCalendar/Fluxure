import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ============================================================
// Hoisted mocks — env vars + DB/pool mocks
// ============================================================

const { mockDb, mockPool } = vi.hoisted(() => {
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

// ============================================================
// Module mocks — consolidated in one block
// ============================================================

vi.mock('../db/pg-index.js', () => ({ db: mockDb, pool: () => mockPool }));
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../ws.js', () => ({ broadcastToUser: vi.fn(), broadcast: vi.fn() }));
vi.mock('../polling-ref.js', () => ({ triggerReschedule: vi.fn() }));
vi.mock('../auth/email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendAccountDeletionEmail: vi.fn().mockResolvedValue(undefined),
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
  }),
}));
vi.mock('../config.js', () => ({
  FRONTEND_URL: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173'],
  INSTANCE_ID: 'test-instance',
  isSelfHosted: () => false,
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

// ============================================================
// Imports (after mocks)
// ============================================================

import authRouter from '../routes/auth.js';
import { hashPassword } from '../auth/password.js';
import { signAccessToken, hashToken } from '../auth/jwt.js';
import cookieParser from 'cookie-parser';

// ============================================================
// Test helpers
// ============================================================

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EMAIL = 'test@example.com';

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
    id: TEST_USER_ID,
    email: TEST_EMAIL,
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
    userId: TEST_USER_ID,
    refreshTokenHash: 'abc123',
    userAgent: 'TestAgent/1.0',
    ipAddress: '192.168.1.*',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function makeAccessToken(overrides: Record<string, unknown> = {}) {
  return signAccessToken({
    userId: TEST_USER_ID,
    email: TEST_EMAIL,
    plan: 'free',
    emailVerified: true,
    hasGdprConsent: true,
    gdprConsentVersion: '1.0',
    ...overrides,
  });
}

function authedGet(path: string) {
  return request(app).get(path).set('Cookie', `access_token=${makeAccessToken()}`);
}

function authedPost(path: string) {
  return request(app).post(path).set('Cookie', `access_token=${makeAccessToken()}`);
}

function authedDelete(path: string) {
  return request(app).delete(path).set('Cookie', `access_token=${makeAccessToken()}`);
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

// ============================================================
// Tests
// ============================================================

describe('Auth Routes', () => {
  beforeEach(resetMocks);

  // ----------------------------------------------------------
  // POST /api/auth/signup
  // ----------------------------------------------------------

  describe('POST /api/auth/signup', () => {
    const validSignup = {
      email: TEST_EMAIL,
      password: 'StrongPass123!',
      name: 'Test User',
      gdprConsent: true,
    };

    it('creates a new user with valid input and returns 201', async () => {
      const newUser = makeUserRow({ emailVerified: false });
      mockDb._setWhereResults([[], [{ count: 0 }], [newUser]]);
      mockDb._mockReturning.mockResolvedValueOnce([newUser]);

      const res = await request(app).post('/api/auth/signup').send(validSignup);

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(TEST_EMAIL);
    });

    it('returns 409 when email already exists', async () => {
      mockDb._setWhereResults([[makeUserRow()]]);

      const res = await request(app).post('/api/auth/signup').send(validSignup);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
    });

    it('returns generic 409 for Google-linked email without leaking account type', async () => {
      mockDb._setWhereResults([[makeUserRow({ googleId: 'google-123' })]]);

      const res = await request(app).post('/api/auth/signup').send(validSignup);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
      expect(res.body.code).toBeUndefined();
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...validSignup, email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for weak password', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...validSignup, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/auth/signup').send({ email: TEST_EMAIL });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 when GDPR consent is not provided', async () => {
      const { gdprConsent: _, ...noConsent } = validSignup;
      const res = await request(app).post('/api/auth/signup').send(noConsent);

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/login
  // ----------------------------------------------------------

  describe('POST /api/auth/login', () => {
    const validLogin = { email: TEST_EMAIL, password: 'CorrectPassword1!' };

    it('authenticates with valid credentials and returns user', async () => {
      const hash = await hashPassword('CorrectPassword1!');
      const user = makeUserRow({ passwordHash: hash });
      mockDb._setWhereResults([[user], [{ count: 0 }], [user]]);

      const res = await request(app).post('/api/auth/login').send(validLogin);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(TEST_EMAIL);
    });

    it('returns 401 for incorrect password', async () => {
      const hash = await hashPassword('CorrectPassword1!');
      const user = makeUserRow({ passwordHash: hash });
      mockDb._setWhereResults([[user]]);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ ...validLogin, password: 'WrongPassword1!' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('returns 401 for non-existent email without leaking existence', async () => {
      mockDb._setWhereResults([[]]);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'SomePassword1!' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('returns generic 401 for Google-only account without leaking account type', async () => {
      const user = makeUserRow({ passwordHash: null, googleId: 'google-123' });
      mockDb._setWhereResults([[user]]);

      const res = await request(app).post('/api/auth/login').send(validLogin);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('returns 400 when fields are missing', async () => {
      const res = await request(app).post('/api/auth/login').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/logout
  // ----------------------------------------------------------

  describe('POST /api/auth/logout', () => {
    it('clears session and returns success with refresh token cookie', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', 'refresh_token=some-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('succeeds gracefully without a refresh token cookie', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/refresh
  // ----------------------------------------------------------

  describe('POST /api/auth/refresh', () => {
    it('returns 401 when no refresh token cookie is present', async () => {
      const res = await request(app).post('/api/auth/refresh');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No refresh token');
    });

    it('returns 401 for invalid or expired refresh token', async () => {
      mockPool._mockClient.query.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid or expired');
    });

    it('rotates tokens and returns success with valid refresh token', async () => {
      const user = makeUserRow();
      mockPool._mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'session-1', user_id: user.id }] }) // SELECT FOR UPDATE
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

  // ----------------------------------------------------------
  // GET /api/auth/verify-email
  // ----------------------------------------------------------

  describe('GET /api/auth/verify-email', () => {
    it('verifies email with valid token', async () => {
      const verification = {
        id: 'v1',
        userId: TEST_USER_ID,
        tokenHash: hashToken('valid-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      mockDb._setWhereResults([[verification]]);

      const res = await request(app).get('/api/auth/verify-email?token=valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('verified');
    });

    it('returns 400 for expired or invalid token', async () => {
      mockDb._setWhereResults([[]]);

      const res = await request(app).get('/api/auth/verify-email?token=expired-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or expired');
    });

    it('returns 400 when token query parameter is missing', async () => {
      const res = await request(app).get('/api/auth/verify-email');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing verification token');
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/resend-verification-email
  // ----------------------------------------------------------

  describe('POST /api/auth/resend-verification-email', () => {
    it('returns success for existing unverified user', async () => {
      const user = makeUserRow({ emailVerified: false });
      mockDb._setWhereResults([[user]]);

      const res = await request(app)
        .post('/api/auth/resend-verification-email')
        .send({ email: TEST_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('verification email');
    });

    it('returns success even for non-existent email to prevent enumeration', async () => {
      mockDb._setWhereResults([[]]);

      const res = await request(app)
        .post('/api/auth/resend-verification-email')
        .send({ email: 'nobody@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns success for already-verified user without sending email', async () => {
      const user = makeUserRow({ emailVerified: true });
      mockDb._setWhereResults([[user]]);

      const { sendVerificationEmail } = await import('../auth/email.js');

      const res = await request(app)
        .post('/api/auth/resend-verification-email')
        .send({ email: TEST_EMAIL });

      expect(res.status).toBe(200);
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/resend-verification-email')
        .send({ email: 'not-email' });

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/forgot-password
  // ----------------------------------------------------------

  describe('POST /api/auth/forgot-password', () => {
    it('returns success message for existing email', async () => {
      mockDb._setWhereResults([[makeUserRow()]]);

      const res = await request(app).post('/api/auth/forgot-password').send({ email: TEST_EMAIL });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('reset link');
    });

    it('returns success even for non-existent email to prevent enumeration', async () => {
      mockDb._setWhereResults([[]]);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('reset link');
    });

    it('returns 400 for invalid email format', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'not-email' });

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/reset-password
  // ----------------------------------------------------------

  describe('POST /api/auth/reset-password', () => {
    it('resets password with valid unused token', async () => {
      const resetRow = {
        id: 'r1',
        userId: TEST_USER_ID,
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

    it('returns 400 for expired or already-used token', async () => {
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

    it('returns 400 when token is missing', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        password: 'NewStrongPass1!',
      });

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------
  // GET /api/auth/me
  // ----------------------------------------------------------

  describe('GET /api/auth/me', () => {
    it('returns current user when authenticated', async () => {
      mockDb._setWhereResults([[makeUserRow()]]);

      const res = await authedGet('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(TEST_EMAIL);
    });

    it('returns 401 when no access token is present', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    it('returns 401 with invalid JWT token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'access_token=invalid-jwt-token');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid or expired');
    });

    it('returns 404 when authenticated user no longer exists in DB', async () => {
      mockDb._setWhereResults([[]]);

      const res = await authedGet('/api/auth/me');

      expect(res.status).toBe(404);
    });
  });

  // ----------------------------------------------------------
  // GET /api/auth/sessions
  // ----------------------------------------------------------

  describe('GET /api/auth/sessions', () => {
    it('returns list of active sessions when authenticated', async () => {
      mockDb._setWhereResults([[makeSessionRow()]]);

      const res = await authedGet('/api/auth/sessions');

      expect(res.status).toBe(200);
      expect(res.body.sessions).toBeDefined();
      expect(Array.isArray(res.body.sessions)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/sessions');

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------
  // DELETE /api/auth/sessions/:id
  // ----------------------------------------------------------

  describe('DELETE /api/auth/sessions/:id', () => {
    const sessionId = '00000000-0000-0000-0000-000000000010';

    it('revokes a specific session', async () => {
      mockDb._setWhereResults([[makeSessionRow()]]);

      const res = await authedDelete(`/api/auth/sessions/${sessionId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('revoked');
    });

    it('returns 404 for non-existent session', async () => {
      mockDb._setWhereResults([[]]);

      const res = await authedDelete('/api/auth/sessions/00000000-0000-0000-0000-000000000099');

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await authedDelete('/api/auth/sessions/not-a-uuid');

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/change-password
  // ----------------------------------------------------------

  describe('POST /api/auth/change-password', () => {
    it('changes password when current password is correct', async () => {
      const hash = await hashPassword('CurrentPass1!');
      mockDb._setWhereResults([[makeUserRow({ passwordHash: hash })]]);

      const res = await authedPost('/api/auth/change-password').send({
        currentPassword: 'CurrentPass1!',
        newPassword: 'NewStrongPass1!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 403 when current password is incorrect', async () => {
      const hash = await hashPassword('CurrentPass1!');
      mockDb._setWhereResults([[makeUserRow({ passwordHash: hash })]]);

      const res = await authedPost('/api/auth/change-password').send({
        currentPassword: 'WrongCurrent1!',
        newPassword: 'NewStrongPass1!',
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('incorrect');
    });

    it('returns 400 when new password is too weak', async () => {
      const res = await authedPost('/api/auth/change-password').send({
        currentPassword: 'CurrentPass1!',
        newPassword: 'short',
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).post('/api/auth/change-password').send({
        currentPassword: 'CurrentPass1!',
        newPassword: 'NewStrongPass1!',
      });

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/export-request
  // ----------------------------------------------------------

  describe('POST /api/auth/export-request', () => {
    it('accepts export request with valid categories', async () => {
      mockDb._setWhereResults([[makeUserRow()]]);

      const res = await authedPost('/api/auth/export-request').send({
        categories: ['profile', 'habits'],
      });

      expect(res.status).toBe(202);
      expect(res.body.message).toContain('Export request accepted');
    });

    it('returns 400 for empty categories array', async () => {
      const res = await authedPost('/api/auth/export-request').send({
        categories: [],
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid category names', async () => {
      const res = await authedPost('/api/auth/export-request').send({
        categories: ['nonexistent'],
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/api/auth/export-request')
        .send({
          categories: ['profile'],
        });

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------
  // DELETE /api/auth/account
  // ----------------------------------------------------------

  describe('DELETE /api/auth/account', () => {
    it('deletes account with correct password confirmation', async () => {
      const hash = await hashPassword('CurrentPass1!');
      const user = makeUserRow({ passwordHash: hash });
      mockDb._setWhereResults([[user]]);

      const res = await authedDelete('/api/auth/account').send({
        confirm: true,
        password: 'CurrentPass1!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 when confirm is not true', async () => {
      const res = await authedDelete('/api/auth/account').send({
        confirm: false,
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when password-having user omits password', async () => {
      const user = makeUserRow();
      mockDb._setWhereResults([[user]]);

      const res = await authedDelete('/api/auth/account').send({
        confirm: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Password is required');
    });

    it('returns 403 when password confirmation is wrong', async () => {
      const hash = await hashPassword('CurrentPass1!');
      const user = makeUserRow({ passwordHash: hash });
      mockDb._setWhereResults([[user]]);

      const res = await authedDelete('/api/auth/account').send({
        confirm: true,
        password: 'WrongPassword1!',
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Invalid password');
    });

    it('deletes Google-only account with email confirmation', async () => {
      const user = makeUserRow({
        passwordHash: null,
        googleId: 'google-123',
        googleRefreshToken: 'encrypted:refresh-token',
      });
      mockDb._setWhereResults([[user]]);

      const res = await authedDelete('/api/auth/account').send({
        confirm: true,
        email: TEST_EMAIL,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for Google-only account with wrong email', async () => {
      const user = makeUserRow({
        passwordHash: null,
        googleId: 'google-123',
        googleRefreshToken: 'encrypted:refresh-token',
      });
      mockDb._setWhereResults([[user]]);

      const res = await authedDelete('/api/auth/account').send({
        confirm: true,
        email: 'wrong@example.com',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email confirmation required');
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).delete('/api/auth/account').send({
        confirm: true,
        password: 'pass',
      });

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------
  // POST /api/auth/consent/withdraw
  // ----------------------------------------------------------

  describe('POST /api/auth/consent/withdraw', () => {
    it('withdraws GDPR consent and pauses scheduling', async () => {
      const user = makeUserRow();
      mockDb._setWhereResults([[user], [{ count: 0 }], [user]]);

      const res = await authedPost('/api/auth/consent/withdraw');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Consent withdrawn');
    });

    it('returns 404 when user does not exist', async () => {
      mockDb._setWhereResults([[]]);

      const res = await authedPost('/api/auth/consent/withdraw');

      expect(res.status).toBe(404);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).post('/api/auth/consent/withdraw');

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------
  // GET /api/auth/google/status
  // ----------------------------------------------------------

  describe('GET /api/auth/google/status', () => {
    it('returns connected: true when Google refresh token exists', async () => {
      mockDb._setWhereResults([[makeUserRow({ googleRefreshToken: 'encrypted:token' })]]);

      const res = await authedGet('/api/auth/google/status');

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
    });

    it('returns connected: false when no Google refresh token', async () => {
      mockDb._setWhereResults([[makeUserRow({ googleRefreshToken: null })]]);

      const res = await authedGet('/api/auth/google/status');

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/google/status');

      expect(res.status).toBe(401);
    });
  });
});
