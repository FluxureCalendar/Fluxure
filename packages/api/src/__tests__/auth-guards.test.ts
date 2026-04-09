import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock jwt module — verifyAccessToken always throws (simulates no valid token)
vi.mock('../auth/jwt.js', () => ({
  verifyAccessToken: vi.fn().mockImplementation(() => {
    throw new Error('Invalid token');
  }),
  getAccessTokenCookieName: vi.fn().mockReturnValue('access_token'),
  signAccessToken: vi.fn(),
  setAuthCookies: vi.fn(),
  setAccessTokenCookie: vi.fn(),
  clearAuthCookies: vi.fn(),
  generateRefreshToken: vi.fn(),
  hashToken: vi.fn(),
  getRefreshTokenExpiry: vi.fn(),
}));

vi.mock('../config.js', () => ({
  FRONTEND_URL: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173'],
  INSTANCE_ID: 'test-instance',
  isSelfHosted: () => false,
  isStripeConfigured: () => false,
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../cache/redis.js', () => ({
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
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
  bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireAuth } from '../middleware/auth.js';

// ── Build a minimal app that mirrors the real route structure ──
// The real index.ts applies requireAuth to all /api routes except
// PUBLIC_ROUTE_PATTERNS (/api/health, /api/auth/*, /api/book/*, /api/webhooks/*).
// Here we mount stub routers behind requireAuth to test the guard.

function createGuardedApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Apply requireAuth to all /api routes (no public exemptions)
  app.use('/api', requireAuth);

  // Stub routers — each returns 200 if auth passes
  const stubHandler = (_req: express.Request, res: express.Response) => {
    res.json({ ok: true });
  };

  app.get('/api/habits', stubHandler);
  app.get('/api/tasks', stubHandler);
  app.get('/api/settings', stubHandler);
  app.get('/api/schedule', stubHandler);
  app.get('/api/billing', stubHandler);
  app.get('/api/focus-time', stubHandler);
  app.get('/api/analytics', stubHandler);
  app.get('/api/calendars', stubHandler);
  app.get('/api/search', stubHandler);
  app.get('/api/links', stubHandler);
  app.get('/api/meetings', stubHandler);
  app.get('/api/scheduling-templates', stubHandler);
  app.get('/api/quick-add', stubHandler);
  app.get('/api/activity', stubHandler);

  return app;
}

// ============================================================
// Auth guards — routes return 401 without authentication
// ============================================================

describe('Auth guards', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createGuardedApp();
  });

  const protectedRoutes = [
    '/api/habits',
    '/api/tasks',
    '/api/settings',
    '/api/schedule',
    '/api/billing',
    '/api/focus-time',
    '/api/analytics',
    '/api/calendars',
    '/api/search',
    '/api/links',
    '/api/meetings',
    '/api/scheduling-templates',
    '/api/quick-add',
    '/api/activity',
  ];

  for (const route of protectedRoutes) {
    it(`GET ${route} returns 401 without auth`, async () => {
      const res = await request(app).get(route);
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  }

  it('returns 401 with invalid cookie token', async () => {
    const res = await request(app).get('/api/habits').set('Cookie', 'access_token=invalid-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with empty cookie', async () => {
    const res = await request(app).get('/api/habits').set('Cookie', 'access_token=');
    // Empty string cookie — requireAuth sees token as empty string,
    // verifyAccessToken throws → 401
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong cookie name', async () => {
    const res = await request(app).get('/api/habits').set('Cookie', 'wrong_cookie=some-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with Authorization header (not used by requireAuth)', async () => {
    // requireAuth only checks cookies, not Authorization header
    const res = await request(app).get('/api/habits').set('Authorization', 'Bearer some-token');
    expect(res.status).toBe(401);
  });

  it('returns JSON error body with message', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required' });
  });

  it('returns "Invalid or expired token" when token fails verification', async () => {
    const res = await request(app).get('/api/tasks').set('Cookie', 'access_token=bad-jwt');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
  });
});

// ============================================================
// Auth guards — email verification enforcement
// ============================================================

describe('Auth guards — email verification', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createGuardedApp();
  });

  it('returns 403 when email is not verified', async () => {
    const { verifyAccessToken } = await import('../auth/jwt.js');
    const mock = verifyAccessToken as ReturnType<typeof vi.fn>;
    mock.mockReturnValue({
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'test@example.com',
      emailVerified: false,
      hasGdprConsent: true,
      gdprConsentVersion: '1.0',
      plan: 'free',
    });

    const res = await request(app).get('/api/habits').set('Cookie', 'access_token=valid-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

// ============================================================
// Auth guards — GDPR consent enforcement
// ============================================================

describe('Auth guards — GDPR consent', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createGuardedApp();
  });

  it('returns 403 when GDPR consent is missing', async () => {
    const { verifyAccessToken } = await import('../auth/jwt.js');
    const mock = verifyAccessToken as ReturnType<typeof vi.fn>;
    mock.mockReturnValue({
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'test@example.com',
      emailVerified: true,
      hasGdprConsent: false,
      gdprConsentVersion: '1.0',
      plan: 'free',
    });

    const res = await request(app).get('/api/habits').set('Cookie', 'access_token=valid-token');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GDPR_CONSENT_REQUIRED');
  });

  it('returns 200 when fully authenticated with consent', async () => {
    const { verifyAccessToken } = await import('../auth/jwt.js');
    const mock = verifyAccessToken as ReturnType<typeof vi.fn>;
    const { GDPR_CONSENT_VERSION } = await import('@fluxure/shared');
    mock.mockReturnValue({
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'test@example.com',
      emailVerified: true,
      hasGdprConsent: true,
      gdprConsentVersion: GDPR_CONSENT_VERSION,
      plan: 'free',
    });

    const res = await request(app).get('/api/habits').set('Cookie', 'access_token=valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
