import { google, Auth } from 'googleapis';

export type OAuth2Client = Auth.OAuth2Client;

/**
 * Create an OAuth2 client configured from environment variables.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI  (defaults to http://localhost:3000/api/auth/google/callback)
 */
export function createOAuth2Client(): OAuth2Client {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (process.env.NODE_ENV === 'production' && !redirectUri) {
    throw new Error('GOOGLE_REDIRECT_URI must be set in production');
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || 'http://localhost:3000/api/auth/google/callback',
  );
}

/**
 * OAuth scopes requested for Google sign-in + Calendar integration.
 *
 * Deliberately minimal (principle of least privilege; also eases Google's
 * sensitive-scope verification review):
 *   - openid/email/profile           identity for sign-in
 *   - calendar.events                read/write events — covers events.list/
 *                                    insert/patch/delete/watch and channels.stop,
 *                                    and is sufficient for conflict/busy detection
 *   - calendar.calendarlist.readonly read-only enumeration of the user's
 *                                    calendars (calendarList.list)
 *
 * The broad `auth/calendar` scope is intentionally NOT requested: it grants
 * calendar deletion, ACL and settings management that Fluxure never uses.
 *
 * Single source of truth — do not inline this list at any other call site.
 */
export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

/**
 * Generate the Google OAuth2 consent screen URL.
 * Requests offline access so we receive a refresh token.
 * Accepts an optional `state` parameter for CSRF protection.
 */
export function getAuthUrl(oauth2Client: OAuth2Client, state?: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GOOGLE_OAUTH_SCOPES],
    ...(state ? { state } : {}),
  });
}

/**
 * Exchange an authorization code (from the OAuth callback) for access + refresh tokens.
 * Automatically sets the credentials on the client.
 */
export async function exchangeCode(
  oauth2Client: OAuth2Client,
  code: string,
): Promise<{
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}> {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  return tokens;
}

/**
 * Restore a previously-stored refresh token onto the OAuth2 client
 * so it can silently obtain new access tokens.
 */
export function setCredentials(oauth2Client: OAuth2Client, refreshToken: string): void {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
}
