import { Router } from 'express';
import { eq, and, gt, ne, sql, lt, asc, count } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod/v4';
import { db, pool as getPool } from '../db/pg-index.js';
import {
  users,
  sessions,
  emailVerifications,
  passwordResets,
  scheduledEvents,
  calendars,
  oauthStates,
} from '../db/pg-schema.js';
import { createOAuth2Client, GoogleCalendarClient } from '../google/index.js';
import { encrypt, decrypt } from '../crypto.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
  setAuthCookies,
  clearAuthCookies,
} from '../auth/jwt.js';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountDeletionEmail,
} from '../auth/email.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  deleteAccountSchema,
} from '../validation.js';
import type { AuthUser, PlanType } from '@fluxure/shared';
import { getTrialEndDate, getEffectivePlan } from '../billing/trial.js';
import {
  RATE_LIMIT,
  EMAIL_VERIFICATION_EXPIRY_MS,
  PASSWORD_RESET_EXPIRY_MS,
  OAUTH_STATE_TTL_MS as OAUTH_STATE_TTL_MS_CONST,
  OAUTH_STATE_CLEANUP_INTERVAL_MS,
  GDPR_CONSENT_VERSION,
  REFRESH_TOKEN_COOKIE,
} from '@fluxure/shared';
import { FRONTEND_URL } from '../config.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createStore } from '../rate-limiters.js';
import { createLogger } from '../logger.js';
import { processDataExport } from '../jobs/data-export.js';
import { getDataExportQueue } from '../jobs/queues.js';

const log = createLogger('auth');

const router = Router();

// Feature flag: set EMAIL_PASSWORD_AUTH=true to enable email/password auth routes
const EMAIL_PASSWORD_AUTH_ENABLED = process.env.EMAIL_PASSWORD_AUTH === 'true';

// ============================================================
// Rate Limiters
// ============================================================

const signupLimiter = rateLimit({
  ...RATE_LIMIT.signup,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many signup attempts, please try again later.' },
  store: createStore('signup'),
});

const loginLimiter = rateLimit({
  ...RATE_LIMIT.login,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
  store: createStore('login'),
});

const forgotPasswordLimiter = rateLimit({
  ...RATE_LIMIT.forgotPassword,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password reset requests, please try again later.' },
  store: createStore('forgot-password'),
});

const resetPasswordLimiter = rateLimit({
  ...RATE_LIMIT.resetPassword,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset attempts, please try again later.' },
  store: createStore('reset-password'),
});

const verifyEmailLimiter = rateLimit({
  ...RATE_LIMIT.verifyEmail,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later.' },
  store: createStore('verify-email'),
});

const changePasswordLimiter = rateLimit({
  ...RATE_LIMIT.changePassword,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many password change attempts, please try again later.' },
  store: createStore('change-password'),
});

const refreshLimiter = rateLimit({
  ...RATE_LIMIT.refresh,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts, please try again later.' },
  store: createStore('refresh'),
});

const meLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  store: createStore('auth-me'),
});

const deleteAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many deletion attempts.' },
  store: createStore('delete-account'),
});

// ============================================================
// Helpers
// ============================================================

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    emailVerified: row.emailVerified,
    googleId: row.googleId,
    hasPassword: !!row.passwordHash,
    plan: (row.plan === 'free' || row.plan === 'pro' ? row.plan : 'free') as PlanType,
    onboardingCompleted: row.onboardingCompleted,
    createdAt: row.createdAt,
  };
}

async function createSession(
  userId: string,
  userAgent: string | undefined,
  ipAddress: string | undefined,
): Promise<{ accessToken: string; refreshToken: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error('User not found');

  const effectivePlan = getEffectivePlan({
    plan: user.plan,
    planPeriodEnd: user.planPeriodEnd,
    stripeSubscriptionId: user.stripeSubscriptionId,
  });

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    plan: effectivePlan,
    emailVerified: !!user.emailVerified,
    hasGdprConsent: !!user.gdprConsentAt,
    gdprConsentVersion: user.consentVersion ?? undefined,
  });

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);

  // Enforce max 10 concurrent sessions per user — delete oldest if at limit
  const MAX_SESSIONS = 10;
  const [{ count: sessionCount }] = await db
    .select({ count: count() })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  if (sessionCount >= MAX_SESSIONS) {
    const oldest = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(asc(sessions.createdAt))
      .limit(1);
    if (oldest.length > 0) {
      await db.delete(sessions).where(eq(sessions.id, oldest[0].id));
    }
  }

  // Mask IP at storage time for GDPR data minimization
  await db.insert(sessions).values({
    userId,
    refreshTokenHash,
    userAgent: userAgent?.slice(0, 500) || null,
    ipAddress: maskIpAddress(ipAddress || null),
    expiresAt: getRefreshTokenExpiry(),
  });

  return { accessToken, refreshToken };
}

function getClientIp(req: import('express').Request): string {
  return req.ip || req.socket.remoteAddress || '';
}

function maskIpAddress(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(':')) {
    // IPv6: show first 3 groups
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + ':*';
  }
  // IPv4: mask last octet
  const parts = ip.split('.');
  if (parts.length === 4) {
    return parts.slice(0, 3).join('.') + '.*';
  }
  return ip;
}

// ============================================================
// POST /api/auth/signup
// ============================================================

router.post(
  '/signup',
  signupLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { email, password, name, gdprConsent } = parsed.data;

    if (!gdprConsent) {
      sendError(res, 400, 'GDPR consent is required');
      return;
    }

    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (existing.length > 0) {
      if (existing[0].googleId) {
        res.status(409).json({
          error: 'An account with this email uses Google sign-in.',
          code: 'GOOGLE_ACCOUNT',
        });
      } else {
        sendError(res, 409, 'An account with this email already exists');
      }
      return;
    }

    const passwordHash = await hashPassword(password);

    // Generate email verification token
    const verifyToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(verifyToken);

    const [newUser] = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({
          email: email.toLowerCase(),
          passwordHash,
          name,
          plan: 'pro',
          planPeriodEnd: getTrialEndDate(),
          gdprConsentAt: new Date().toISOString(),
          consentVersion: GDPR_CONSENT_VERSION,
        })
        .returning();

      await tx.insert(emailVerifications).values({
        userId: inserted[0].id,
        tokenHash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS).toISOString(),
      });

      return inserted;
    });

    sendVerificationEmail(email.toLowerCase(), verifyToken).catch((err) => {
      log.error({ err }, 'Failed to send verification email');
    });

    const { accessToken, refreshToken } = await createSession(
      newUser.id,
      req.headers['user-agent'],
      getClientIp(req),
    );
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({ user: toAuthUser(newUser) });
  }),
);

// ============================================================
// POST /api/auth/login
// ============================================================

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    if (!user) {
      // Run bcrypt against a dummy hash to equalize response timing (prevent timing oracle)
      await verifyPassword(password, '$2b$12$000000000000000000000uGbOQPJ9K7.1JCJfUnpDBqkEGfjXbkm');
      sendError(res, 401, 'Invalid email or password');
      return;
    }

    if (!user.passwordHash && user.googleId) {
      res.status(409).json({ error: 'This account uses Google sign-in.', code: 'GOOGLE_ACCOUNT' });
      return;
    }

    if (!user.passwordHash) {
      await verifyPassword(password, '$2b$12$000000000000000000000uGbOQPJ9K7.1JCJfUnpDBqkEGfjXbkm');
      sendError(res, 401, 'Invalid email or password');
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      sendError(res, 401, 'Invalid email or password');
      return;
    }

    const { accessToken, refreshToken } = await createSession(
      user.id,
      req.headers['user-agent'],
      getClientIp(req),
    );
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ user: toAuthUser(user) });
  }),
);

// ============================================================
// POST /api/auth/refresh
// ============================================================

router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const oldRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!oldRefreshToken) {
      sendError(res, 401, 'No refresh token');
      return;
    }

    const oldHash = hashToken(oldRefreshToken);
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Find and lock the session row atomically
      const { rows: sessionRows } = await client.query(
        `SELECT id, user_id FROM sessions
       WHERE refresh_token_hash = $1 AND expires_at > NOW()
       FOR UPDATE`,
        [oldHash],
      );

      if (sessionRows.length === 0) {
        await client.query('ROLLBACK');
        clearAuthCookies(res);
        sendError(res, 401, 'Invalid or expired refresh token');
        return;
      }

      const session = sessionRows[0];

      await client.query('DELETE FROM sessions WHERE id = $1', [session.id]);

      await client.query('COMMIT');

      const { accessToken, refreshToken } = await createSession(
        session.user_id,
        req.headers['user-agent'],
        getClientIp(req),
      );
      setAuthCookies(res, accessToken, refreshToken);

      // Include user so frontend doesn't need a separate GET /auth/me call
      const [user] = await db.select().from(users).where(eq(users.id, session.user_id));
      res.json({ success: true, user: user ? toAuthUser(user) : undefined });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

// ============================================================
// POST /api/auth/logout
// ============================================================

router.post(
  '/logout',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await db.delete(sessions).where(eq(sessions.refreshTokenHash, tokenHash));
    }

    clearAuthCookies(res);
    res.json({ success: true });
  }),
);

// ============================================================
// GET /api/auth/verify-email?token=
// ============================================================

router.get(
  '/verify-email',
  verifyEmailLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const token = req.query.token as string;
    if (!token) {
      sendError(res, 400, 'Missing verification token');
      return;
    }

    const tokenHash = hashToken(token);

    const [verification] = await db
      .select()
      .from(emailVerifications)
      .where(
        and(
          eq(emailVerifications.tokenHash, tokenHash),
          gt(emailVerifications.expiresAt, new Date().toISOString()),
        ),
      );

    if (!verification) {
      sendError(res, 400, 'Invalid or expired verification token');
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date().toISOString() })
        .where(eq(users.id, verification.userId));
      await tx.delete(emailVerifications).where(eq(emailVerifications.userId, verification.userId));
    });

    res.json({ success: true, message: 'Email verified successfully' });
  }),
);

// ============================================================
// POST /api/auth/resend-verification-email
// ============================================================

router.post(
  '/resend-verification-email',
  signupLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'Valid email is required');
      return;
    }
    const { email } = parsed.data;

    // Always return success (prevent email enumeration)
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));

    if (user && !user.emailVerified) {
      await db.delete(emailVerifications).where(eq(emailVerifications.userId, user.id));

      const verifyToken = randomBytes(32).toString('hex');
      const tokenHash = hashToken(verifyToken);

      await db.insert(emailVerifications).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS).toISOString(),
      });

      sendVerificationEmail(email.toLowerCase(), verifyToken).catch((err) => {
        log.error({ err }, 'Failed to resend verification email');
      });
    }

    res.json({
      success: true,
      message:
        'If an account with that email exists and is unverified, a new verification email has been sent.',
    });
  }),
);

// ============================================================
// POST /api/auth/forgot-password
// ============================================================

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid input');
      return;
    }

    const { email } = parsed.data;

    // Always return success (prevent email enumeration)
    // Pad response time to eliminate timing side-channel
    const startTime = Date.now();

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));

    if (user) {
      const resetToken = randomBytes(32).toString('hex');
      const tokenHash = hashToken(resetToken);

      // Invalidate existing unused reset tokens for this user
      await db
        .delete(passwordResets)
        .where(and(eq(passwordResets.userId, user.id), sql`${passwordResets.usedAt} IS NULL`));

      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS).toISOString(),
      });

      void sendPasswordResetEmail(email.toLowerCase(), resetToken).catch((err) => {
        log.error({ err }, 'Failed to send password reset email');
      });
    }

    // Pad response time to a minimum to reduce timing side-channel
    const elapsed = Date.now() - startTime;
    const minResponseMs = 200;
    if (elapsed < minResponseMs) {
      await new Promise((resolve) => setTimeout(resolve, minResponseMs - elapsed));
    }

    res.json({
      message: 'If an account exists with that email, a reset link has been sent.',
    });
  }),
);

// ============================================================
// POST /api/auth/reset-password
// ============================================================

router.post(
  '/reset-password',
  resetPasswordLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { token, password } = parsed.data;
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    // Atomic: mark token as used only if it hasn't been used yet (prevents TOCTOU)
    const updated = await db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          gt(passwordResets.expiresAt, now),
          sql`${passwordResets.usedAt} IS NULL`,
        ),
      )
      .returning();

    if (updated.length === 0) {
      sendError(res, 400, 'Invalid or expired reset token');
      return;
    }

    const reset = updated[0];
    const passwordHash = await hashPassword(password);

    await db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, reset.userId));

    // Force re-login on all sessions after password reset
    await db.delete(sessions).where(eq(sessions.userId, reset.userId));

    res.json({ success: true, message: 'Password reset successfully' });
  }),
);

// ============================================================
// Google OAuth — unified sign-in + calendar scoping
// ============================================================

/** Standalone cleanup function for use by BullMQ maintenance worker */
export async function cleanupOauthStates(): Promise<void> {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date().toISOString()));
}

// Cleanup expired OAuth states periodically (fallback when BullMQ unavailable)
let oauthCleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Start periodic OAuth state cleanup. Only call when BullMQ is not available. */
export function startOAuthCleanupFallback(): void {
  if (oauthCleanupInterval) return;
  oauthCleanupInterval = setInterval(async () => {
    try {
      await cleanupOauthStates();
    } catch (err) {
      log.warn({ err }, 'OAuth state cleanup failed');
    }
  }, OAUTH_STATE_CLEANUP_INTERVAL_MS);
}

/** Stop the OAuth cleanup timer (for graceful shutdown). */
export function stopOAuthCleanup(): void {
  if (oauthCleanupInterval) {
    clearInterval(oauthCleanupInterval);
    oauthCleanupInterval = null;
  }
}

// GET /api/auth/google — initiate unified OAuth
router.get(
  '/google',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const oauth2Client = createOAuth2Client();
    const state = randomBytes(16).toString('hex');
    const stateHash = createHash('sha256').update(state).digest('hex');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS_CONST).toISOString();

    await db.insert(oauthStates).values({ stateHash, expiresAt });

    // Prompt logic:
    // - 'select_account': explicit override from frontend (retry flow)
    // - 'consent': explicit override, or when logged-in user has no refresh token yet
    // - omitted: default — Google auto-skips consent for users who already authorized
    //   the app (no refresh_token returned, but we already have one stored from first auth)
    const ALLOWED_PROMPTS = ['consent', 'select_account'] as const;
    const rawPrompt = req.query.prompt as string | undefined;
    let promptParam: string | undefined;
    if (rawPrompt && (ALLOWED_PROMPTS as readonly string[]).includes(rawPrompt)) {
      promptParam = rawPrompt;
    } else if (req.userId) {
      // Logged-in user: check if they need a refresh token (first Google connection)
      const [existing] = await db
        .select({ grt: users.googleRefreshToken })
        .from(users)
        .where(eq(users.id, req.userId));
      if (!existing?.grt) {
        promptParam = 'consent'; // Need refresh_token — force consent
      }
      // Otherwise omit prompt — Google skips consent, we already have the token
    }
    // Logged-out user: omit prompt — Google shows consent only if app not yet authorized

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      state,
      ...(promptParam ? { prompt: promptParam } : {}),
    });

    res.json({ redirectUrl: url });
  }),
);

/** Validate and return the frontend origin URL. */
function getFrontendOrigin(): string {
  const rawFrontendOrigin = FRONTEND_URL;
  try {
    const parsed = new URL(rawFrontendOrigin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    return parsed.origin;
  } catch {
    log.error(
      { rawFrontendOrigin },
      'Invalid FRONTEND_URL/CORS_ORIGIN — cannot construct safe redirect',
    );
    throw new Error('FRONTEND_URL is not a valid URL');
  }
}

/** Find or create user from Google OAuth profile and tokens. */
async function findOrCreateGoogleUser(
  googleId: string,
  email: string,
  name: string | null,
  avatarUrl: string | null,
  tokens: { refresh_token?: string | null },
): Promise<typeof users.$inferSelect> {
  let [user] = await db.select().from(users).where(eq(users.googleId, googleId));

  if (!user) {
    [user] = await db.select().from(users).where(eq(users.email, email));

    if (user) {
      // Link Google account to existing user
      await db
        .update(users)
        .set({
          googleId,
          emailVerified: true,
          avatarUrl: avatarUrl || user.avatarUrl,
          googleRefreshToken: tokens.refresh_token
            ? encrypt(tokens.refresh_token)
            : user.googleRefreshToken,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, user.id));
      // Invalidate existing sessions on account linking
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      [user] = await db.select().from(users).where(eq(users.id, user.id));
    } else {
      // GDPR consent deferred to onboarding
      [user] = await db
        .insert(users)
        .values({
          email,
          emailVerified: true,
          name,
          avatarUrl,
          googleId,
          googleRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          plan: 'pro',
          planPeriodEnd: getTrialEndDate(),
          gdprConsentAt: null,
          consentVersion: null,
        })
        .returning();
    }
  } else {
    // Existing Google user — update refresh token if provided
    if (tokens.refresh_token) {
      await db
        .update(users)
        .set({
          googleRefreshToken: encrypt(tokens.refresh_token),
          avatarUrl: avatarUrl || user.avatarUrl,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, user.id));
    }
  }

  // Re-fetch user to get latest state
  [user] = await db.select().from(users).where(eq(users.id, user.id));
  return user;
}

// GET /api/auth/google/callback — handle OAuth callback
router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const frontendOrigin = getFrontendOrigin();

    // If Google returned an error (e.g. prompt=none failed), retry with select_account
    const oauthError = req.query.error as string | undefined;
    if (oauthError) {
      if (
        oauthError === 'interaction_required' ||
        oauthError === 'consent_required' ||
        oauthError === 'login_required'
      ) {
        res.redirect(`${frontendOrigin}/login?google_retry=1`);
        return;
      }
      log.warn({ oauthError }, 'OAuth callback error');
      res.redirect(`${frontendOrigin}/login?error=auth_failed`);
      return;
    }

    const code = req.query.code as string;
    const state = req.query.state as string | undefined;

    if (!code || !state) {
      log.warn('OAuth callback missing code or state parameter');
      res.redirect(`${frontendOrigin}/login?error=auth_failed`);
      return;
    }

    const stateHash = createHash('sha256').update(state).digest('hex');
    const stateRows = await db
      .delete(oauthStates)
      .where(
        and(
          eq(oauthStates.stateHash, stateHash),
          gt(oauthStates.expiresAt, new Date().toISOString()),
        ),
      )
      .returning({ stateHash: oauthStates.stateHash });

    if (stateRows.length === 0) {
      log.warn('OAuth callback: invalid or expired state');
      res.redirect(`${frontendOrigin}/login?error=auth_failed`);
      return;
    }

    try {
      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const { google: googleapis } = await import('googleapis');
      const oauth2 = googleapis.oauth2({ version: 'v2', auth: oauth2Client });
      const { data: profile } = await oauth2.userinfo.get();

      if (!profile.id || !profile.email) {
        log.warn('OAuth: Google profile missing id or email');
        res.redirect(`${frontendOrigin}/login?error=auth_failed`);
        return;
      }

      const user = await findOrCreateGoogleUser(
        profile.id,
        profile.email.toLowerCase(),
        profile.name || null,
        profile.picture || null,
        tokens,
      );

      // Safety net: if user still has no refresh token, re-auth with consent to get one
      if (!user.googleRefreshToken) {
        res.redirect(`${frontendOrigin}/login?google_consent=1`);
        return;
      }

      const { accessToken, refreshToken } = await createSession(
        user.id,
        req.headers['user-agent'],
        getClientIp(req),
      );
      setAuthCookies(res, accessToken, refreshToken);

      // Only start scheduler if user has consented to GDPR
      if (user.gdprConsentAt) {
        schedulerRegistry.getOrCreate(user.id).catch((err) => {
          log.error({ err }, 'Failed to start scheduler after Google OAuth');
        });
      }

      if (!user.onboardingCompleted) {
        res.redirect(`${frontendOrigin}/onboarding?step=2`);
      } else {
        res.redirect(`${frontendOrigin}/?google=connected`);
      }
    } catch (error: unknown) {
      log.error({ err: error }, 'Google OAuth error');
      res.redirect(`${frontendOrigin}/login?error=oauth_failed`);
    }
  }),
);

// ============================================================
// GET /api/auth/me — current user profile
// ============================================================

router.get(
  '/me',
  meLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId));
    if (!user) {
      sendNotFound(res, 'User');
      return;
    }

    res.json({ user: toAuthUser(user) });
  }),
);

// ============================================================
// GET /api/auth/google/status — check Google connection status
// ============================================================

router.get(
  '/google/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId));
    const connected = !!user?.googleRefreshToken;
    res.json({ connected });
  }),
);

// ============================================================
// GDPR: Consent Withdrawal — POST /api/auth/consent/withdraw
// ============================================================

router.post(
  '/consent/withdraw',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      sendNotFound(res, 'User');
      return;
    }

    await db
      .update(users)
      .set({ gdprConsentAt: null, consentVersion: null, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    try {
      const scheduler = schedulerRegistry.get(userId);
      if (scheduler) {
        await scheduler.stop();
      }
    } catch (err) {
      log.error({ err }, 'Failed to stop scheduler during consent withdrawal');
    }

    if (user.googleRefreshToken) {
      try {
        const refreshToken = decrypt(user.googleRefreshToken);
        const oauth2Client = createOAuth2Client();
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        await oauth2Client.revokeCredentials();
      } catch (err) {
        log.error({ err }, 'Failed to revoke Google token during consent withdrawal');
      }
      await db
        .update(users)
        .set({ googleRefreshToken: null, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    }

    // Delete sessions before re-issuing tokens to prevent TOCTOU race
    await db.delete(sessions).where(eq(sessions.userId, userId));

    // Re-issue tokens with hasGdprConsent: false
    const { accessToken, refreshToken } = await createSession(
      userId,
      req.headers['user-agent'],
      req.ip,
    );

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      success: true,
      message: 'Consent withdrawn. Your account data is preserved but scheduling is paused.',
    });
  }),
);

// ============================================================
// GDPR: Data Export (email) — POST /api/auth/export-request
// ============================================================

const exportLimiter = rateLimit({
  ...RATE_LIMIT.dataExport,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Only one export per hour is allowed.' },
  store: createStore('export'),
});

const exportRequestSchema = z.object({
  categories: z
    .array(
      z.enum([
        'profile',
        'habits',
        'tasks',
        'meetings',
        'focus',
        'buffers',
        'calendars',
        'calendarEvents',
        'scheduledEvents',
        'habitCompletions',
        'activityLog',
        'scheduleChanges',
        'schedulingLinks',
        'schedulingTemplates',
      ]),
    )
    .min(1),
});

router.post(
  '/export-request',
  requireAuth,
  exportLimiter,
  asyncHandler(async (req, res) => {
    const parsed = exportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const userId = req.userId;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      sendNotFound(res, 'User');
      return;
    }

    // Enqueue via BullMQ if available, otherwise fire-and-forget directly
    const exportQueue = getDataExportQueue();
    if (exportQueue) {
      const job = await exportQueue.add(
        'data-export',
        { userId, categories: parsed.data.categories },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
      log.info({ userId, jobId: job.id }, 'Data export job enqueued');
    } else {
      processDataExport(userId, parsed.data.categories).catch((err) => {
        log.error({ userId, err }, 'Background data export failed');
      });
    }

    res
      .status(202)
      .json({ message: 'Export request accepted. You will receive an email shortly.' });
  }),
);

// ============================================================
// GDPR: Account Deletion — DELETE /api/auth/account
// ============================================================

router.delete(
  '/account',
  deleteAccountLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    if (!parsed.data.confirm) {
      sendError(res, 400, 'Account deletion must be explicitly confirmed');
      return;
    }

    const userId = req.userId;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      sendNotFound(res, 'User');
      return;
    }

    // If user has a password, require it for confirmation
    if (user.passwordHash) {
      if (!parsed.data.password) {
        sendError(res, 400, 'Password is required to delete account');
        return;
      }
      const valid = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!valid) {
        sendError(res, 403, 'Invalid password');
        return;
      }
    } else {
      // Google-only users: require email confirmation
      if (!parsed.data.email || parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
        sendError(res, 400, 'Email confirmation required to delete account');
        return;
      }
    }

    // Clean up Google Calendar events before deleting the account
    if (user.googleRefreshToken) {
      try {
        const refreshToken = decrypt(user.googleRefreshToken);
        const oauth2Client = createOAuth2Client();
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const calendarClient = new GoogleCalendarClient(oauth2Client);

        const events = await db
          .select({
            googleEventId: scheduledEvents.googleEventId,
            calendarId: scheduledEvents.calendarId,
          })
          .from(scheduledEvents)
          .where(eq(scheduledEvents.userId, userId));

        const userCalendars = await db
          .select({
            id: calendars.id,
            googleCalendarId: calendars.googleCalendarId,
            watchChannelId: calendars.watchChannelId,
            watchResourceId: calendars.watchResourceId,
          })
          .from(calendars)
          .where(eq(calendars.userId, userId));
        const calendarIdMap = new Map(userCalendars.map((c) => [c.id, c.googleCalendarId]));

        for (const cal of userCalendars) {
          if (cal.watchChannelId && cal.watchResourceId) {
            try {
              await calendarClient.stopWatch(cal.watchChannelId, cal.watchResourceId);
            } catch (err) {
              log.warn(
                { channelId: cal.watchChannelId, err },
                'Failed to stop watch channel during account deletion',
              );
            }
          }
        }

        // Best-effort: don't block deletion on individual event failures
        for (const event of events) {
          if (!event.googleEventId || !event.calendarId) continue;
          const googleCalendarId = calendarIdMap.get(event.calendarId);
          if (!googleCalendarId) continue;
          try {
            await calendarClient.deleteEvent(googleCalendarId, event.googleEventId);
          } catch (err) {
            log.warn(
              { googleEventId: event.googleEventId, err },
              'Failed to delete managed event from Google Calendar during account deletion',
            );
          }
        }
      } catch (err) {
        log.error({ err }, 'Failed to delete Google Calendar events during account deletion');
        // Continue with deletion even if this fails
      }
    }

    if (user.googleRefreshToken) {
      try {
        const refreshToken = decrypt(user.googleRefreshToken);
        const oauth2Client = createOAuth2Client();
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        await oauth2Client.revokeCredentials();
      } catch (err) {
        log.error({ err }, 'Failed to revoke Google token during account deletion');
        // Continue with deletion even if revocation fails
      }
    }

    try {
      const scheduler = schedulerRegistry.get(userId);
      if (scheduler) {
        await scheduler.stop();
      }
    } catch (err) {
      log.error({ err }, 'Failed to stop scheduler during account deletion');
    }

    const deletedEmail = user.email;
    const deletedAt = new Date().toISOString();

    // ON DELETE CASCADE handles all domain data
    await db.delete(users).where(eq(users.id, userId));

    void sendAccountDeletionEmail(deletedEmail, deletedAt).catch((err) =>
      log.error({ err }, 'Account deletion confirmation email failed'),
    );

    clearAuthCookies(res);

    res.json({ success: true, message: 'Account deleted successfully' });
  }),
);

// ============================================================
// GDPR: Session Management — GET /api/auth/sessions
// ============================================================

router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const currentRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : null;

    const userSessions = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date().toISOString())));

    const result = userSessions.map((s) => {
      let isCurrent = false;
      if (currentHash) {
        try {
          const a = Buffer.from(s.refreshTokenHash, 'hex');
          const b = Buffer.from(currentHash, 'hex');
          isCurrent = a.length === b.length && timingSafeEqual(a, b);
        } catch {
          isCurrent = false;
        }
      }
      return {
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: maskIpAddress(s.ipAddress),
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: isCurrent,
      };
    });

    res.json({ sessions: result });
  }),
);

// ============================================================
// GDPR: Revoke Session — DELETE /api/auth/sessions/:id
// ============================================================

router.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id as string;
    if (!validateUUID(sessionId, res)) return;
    const userId = req.userId;

    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (!session) {
      sendNotFound(res, 'Session');
      return;
    }

    let isCurrentSession = false;
    const currentRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (currentRefreshToken) {
      const currentHash = hashToken(currentRefreshToken);
      try {
        const a = Buffer.from(session.refreshTokenHash, 'hex');
        const b = Buffer.from(currentHash, 'hex');
        isCurrentSession = a.length === b.length && timingSafeEqual(a, b);
      } catch {
        /* hash comparison failed, proceed normally */
      }
    }

    // Delete before responding to avoid race condition
    await db.delete(sessions).where(eq(sessions.id, sessionId));

    if (isCurrentSession) {
      res.json({
        success: true,
        message: 'Session revoked',
        warning: 'You revoked your current session. Use /api/auth/logout to sign out properly.',
      });
    } else {
      res.json({ success: true, message: 'Session revoked' });
    }
  }),
);

// ============================================================
// GDPR: Revoke All Other Sessions — DELETE /api/auth/sessions
// ============================================================

router.delete(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const currentRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];

    if (!currentRefreshToken) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
      res.json({ success: true, message: 'All sessions revoked' });
      return;
    }

    const currentHash = hashToken(currentRefreshToken);

    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.refreshTokenHash, currentHash)));

    res.json({ success: true, message: 'Other sessions revoked' });
  }),
);

// ============================================================
// Change Password — POST /api/auth/change-password
// ============================================================

router.post(
  '/change-password',
  requireAuth,
  changePasswordLimiter,
  asyncHandler(async (req, res) => {
    if (!EMAIL_PASSWORD_AUTH_ENABLED) {
      res
        .status(410)
        .json({ error: 'Email/password authentication is disabled. Please use Google sign-in.' });
      return;
    }

    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { currentPassword, newPassword } = parsed.data;
    const userId = req.userId;

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      sendNotFound(res, 'User');
      return;
    }

    if (!user.passwordHash) {
      sendError(
        res,
        400,
        'Account uses Google sign-in only. Set a password via forgot-password flow.',
      );
      return;
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      sendError(res, 403, 'Current password is incorrect');
      return;
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    const currentRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (currentRefreshToken) {
      const currentHash = hashToken(currentRefreshToken);
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.refreshTokenHash, currentHash)));
    } else {
      // No current token — revoke all sessions
      await db.delete(sessions).where(eq(sessions.userId, userId));
    }

    res.json({ success: true, message: 'Password changed successfully' });
  }),
);

export default router;
