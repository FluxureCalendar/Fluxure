import type { Request, Response, NextFunction } from 'express';
import type { PlanType } from '@fluxure/shared';
import type { Logger } from 'pino';
import { verifyAccessToken, getAccessTokenCookieName } from '../auth/jwt.js';
import { GDPR_CONSENT_VERSION } from '@fluxure/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      reqId: string;
      userId: string;
      userEmail: string;
      userPlan: PlanType;
      log: Logger;
    }
  }
}

/**
 * Optional JWT authentication middleware.
 * If a valid access token is present, attaches userId/userEmail/userPlan to the request.
 * If not, continues without error (req.userId will be undefined).
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[getAccessTokenCookieName()];
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      if (payload.emailVerified) {
        req.userId = payload.userId;
        req.userEmail = payload.email;
        req.userPlan = payload.plan;
      }
    } catch {
      // Invalid token — proceed as unauthenticated
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[getAccessTokenCookieName()];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    if (!payload.emailVerified) {
      res.status(403).json({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' });
      return;
    }

    // Enforce GDPR consent for non-auth API routes
    // Exempt only specific onboarding-related routes (auth, calendar discovery, timezone)
    // Tokens without hasGdprConsent (undefined/false) are treated as not-consented
    const url = req.originalUrl;
    const method = req.method;
    // Onboarding-exempt routes: allow these without GDPR consent so the
    // onboarding wizard can complete (calendar discovery, timezone, settings save,
    // habit creation, and the consent-grant endpoint itself).
    const isExemptRoute =
      url.startsWith('/api/auth/') ||
      url === '/api/auth' ||
      (url === '/api/calendars' && method === 'GET') ||
      url.startsWith('/api/calendars/discover') ||
      (url === '/api/settings/timezone' && method === 'PUT') ||
      (url === '/api/settings/onboarding/complete' && method === 'POST') ||
      (url === '/api/settings' && method === 'PUT') ||
      (url.startsWith('/api/habits') && method === 'POST');
    if (!payload.hasGdprConsent && !isExemptRoute) {
      res.status(403).json({ error: 'GDPR consent required', code: 'GDPR_CONSENT_REQUIRED' });
      return;
    }

    // Check consent version — require re-consent if version has changed
    // Tokens missing gdprConsentVersion (issued before version tracking) are treated as stale
    if (payload.hasGdprConsent && payload.gdprConsentVersion !== GDPR_CONSENT_VERSION) {
      if (!isExemptRoute) {
        res.status(403).json({
          error: 'Privacy policy updated — please review and re-consent',
          code: 'CONSENT_UPDATE_REQUIRED',
        });
        return;
      }
    }

    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.userPlan = payload.plan;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
