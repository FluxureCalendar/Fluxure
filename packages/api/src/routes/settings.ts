import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users, calendars } from '../db/pg-schema.js';
import type { UserSettings } from '@fluxure/shared';
import { GDPR_CONSENT_VERSION } from '@fluxure/shared';
import { userSettingsSchema } from '../validation.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';
import { createOAuth2Client } from '../google/index.js';
import { decrypt } from '../crypto.js';
import { DEFAULT_USER_SETTINGS } from './defaults.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';
import { invalidateUserSettingsCache } from '../cache/user-settings.js';
import rateLimit from 'express-rate-limit';
import { createStore } from '../rate-limiters.js';

const log = createLogger('settings');

const googleDisconnectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many disconnect attempts, please try again later.' },
  store: createStore('google-disconnect'),
});

const router = Router();

// GET /api/settings — return user settings
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userRows = await db.select().from(users).where(eq(users.id, req.userId));
    if (userRows.length === 0) {
      sendNotFound(res, 'User');
      return;
    }

    const user = userRows[0];
    const settings: UserSettings =
      user.settings && typeof user.settings === 'object'
        ? (user.settings as UserSettings)
        : DEFAULT_USER_SETTINGS;

    res.json({
      id: user.id,
      settings,
      googleConnected: !!user.googleRefreshToken,
      createdAt: user.createdAt ?? '',
    });
  }),
);

// PUT /api/settings — update user settings
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = userSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const userRows = await db.select().from(users).where(eq(users.id, req.userId));
    if (userRows.length === 0) {
      sendNotFound(res, 'User');
      return;
    }

    const user = userRows[0];
    const currentSettings: UserSettings =
      user.settings && typeof user.settings === 'object'
        ? (user.settings as UserSettings)
        : DEFAULT_USER_SETTINGS;

    if (parsed.data.defaultHabitCalendarId) {
      const [cal] = await db
        .select({ id: calendars.id })
        .from(calendars)
        .where(
          and(
            eq(calendars.id, parsed.data.defaultHabitCalendarId),
            eq(calendars.userId, req.userId),
          ),
        );
      if (!cal) {
        sendError(res, 400, 'Invalid calendar ID for default habit calendar');
        return;
      }
    }
    if (parsed.data.defaultTaskCalendarId) {
      const [cal] = await db
        .select({ id: calendars.id })
        .from(calendars)
        .where(
          and(
            eq(calendars.id, parsed.data.defaultTaskCalendarId),
            eq(calendars.userId, req.userId),
          ),
        );
      if (!cal) {
        sendError(res, 400, 'Invalid calendar ID for default task calendar');
        return;
      }
    }

    const updatedSettings: UserSettings = {
      ...currentSettings,
      ...parsed.data,
    };

    await db
      .update(users)
      .set({ settings: updatedSettings, updatedAt: new Date().toISOString() })
      .where(eq(users.id, req.userId));

    await invalidateUserSettingsCache(req.userId);

    res.json({ id: user.id, settings: updatedSettings, createdAt: user.createdAt ?? '' });
  }),
);

// POST /api/settings/onboarding/complete — mark onboarding as completed
router.post(
  '/onboarding/complete',
  asyncHandler(async (req, res) => {
    // Read actual user to get current emailVerified state
    const [user] = await db.select().from(users).where(eq(users.id, req.userId));
    if (!user) {
      sendNotFound(res, 'User');
      return;
    }

    const now = new Date().toISOString();
    await db
      .update(users)
      .set({
        onboardingCompleted: true,
        gdprConsentAt: now,
        consentVersion: GDPR_CONSENT_VERSION,
        updatedAt: now,
      })
      .where(eq(users.id, req.userId));

    // Re-issue access token with hasGdprConsent=true so the GDPR middleware unblocks
    const { signAccessToken, setAccessTokenCookie } = await import('../auth/jwt.js');
    const accessToken = signAccessToken({
      userId: req.userId,
      email: req.userEmail,
      plan: req.userPlan,
      emailVerified: !!user.emailVerified,
      hasGdprConsent: true,
      gdprConsentVersion: GDPR_CONSENT_VERSION,
    });
    setAccessTokenCookie(res, accessToken);

    res.json({ onboardingCompleted: true });
  }),
);

// GET /api/settings/google/status — deprecated, use GET /api/settings (includes googleConnected)
router.get(
  '/google/status',
  asyncHandler(async (req, res) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', '2026-06-01');
    const userRows = await db.select().from(users).where(eq(users.id, req.userId));
    const connected = userRows.length > 0 && !!userRows[0].googleRefreshToken;
    res.json({ connected });
  }),
);

// POST /api/settings/google/disconnect — disconnect Google
router.post(
  '/google/disconnect',
  googleDisconnectLimiter,
  asyncHandler(async (req, res) => {
    const userRows = await db.select().from(users).where(eq(users.id, req.userId));
    if (userRows.length === 0) {
      sendNotFound(res, 'User');
      return;
    }

    if (userRows[0].googleRefreshToken) {
      try {
        const refreshToken = decrypt(userRows[0].googleRefreshToken);
        const oauth2Client = createOAuth2Client();
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        await oauth2Client.revokeCredentials();
      } catch (err) {
        log.error({ err }, 'Failed to revoke Google token');
      }
    }

    await db
      .update(users)
      .set({ googleRefreshToken: null, googleSyncToken: null, updatedAt: new Date().toISOString() })
      .where(eq(users.id, req.userId));

    res.json({ message: 'Google disconnected' });
  }),
);

export default router;
