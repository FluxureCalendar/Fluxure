import { describe, it, expect } from 'vitest';
import { GOOGLE_OAUTH_SCOPES, getAuthUrl, createOAuth2Client } from '../google/auth.js';

// Keep dev defaults (createOAuth2Client throws in production without a redirect URI).
process.env.NODE_ENV = 'test';

/**
 * Scope-rot guard.
 *
 * Fluxure deliberately requests the minimal Google OAuth scope set so that
 * Google's sensitive-scope verification stays lightweight and the app follows
 * least privilege. If a future change widens this set (e.g. re-adds the broad
 * `auth/calendar` scope, or any ACL/settings/read-only-calendar scope), these
 * tests must fail loudly rather than silently re-expanding the OAuth grant —
 * which would also invalidate the Google verification submission.
 *
 * If a scope genuinely needs to change: update GOOGLE_OAUTH_SCOPES, update the
 * Google Cloud Console "Data Access" config to match, and update this test in
 * the same change so the three stay in sync.
 */
const EXPECTED_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

// Scopes that must never appear: each grants strictly more than Fluxure uses.
const FORBIDDEN_SCOPES = [
  'https://www.googleapis.com/auth/calendar', // broad: delete calendars, ACLs, settings
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.acls',
  'https://www.googleapis.com/auth/calendar.acls.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://www.googleapis.com/auth/calendar.calendars',
  'https://www.googleapis.com/auth/calendar.calendarlist', // read/write calendar list
];

describe('GOOGLE_OAUTH_SCOPES', () => {
  it('is exactly the minimal expected scope set (order-independent)', () => {
    expect([...GOOGLE_OAUTH_SCOPES].sort()).toEqual([...EXPECTED_SCOPES].sort());
  });

  it('contains no broader-than-needed Calendar scope', () => {
    for (const forbidden of FORBIDDEN_SCOPES) {
      expect(GOOGLE_OAUTH_SCOPES as readonly string[]).not.toContain(forbidden);
    }
  });

  it('requests calendar.events for event read/write and only read-only calendar listing', () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(GOOGLE_OAUTH_SCOPES).toContain(
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    );
  });

  it('has no duplicate scopes', () => {
    expect(new Set(GOOGLE_OAUTH_SCOPES).size).toBe(GOOGLE_OAUTH_SCOPES.length);
  });
});

describe('getAuthUrl', () => {
  it('embeds exactly GOOGLE_OAUTH_SCOPES and requests offline + consent', () => {
    const url = new URL(getAuthUrl(createOAuth2Client(), 'state-token'));

    const urlScopes = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
    expect(urlScopes.sort()).toEqual([...GOOGLE_OAUTH_SCOPES].sort());

    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-token');
  });

  it('never leaks the broad auth/calendar scope into the consent URL', () => {
    const scope = new URL(getAuthUrl(createOAuth2Client())).searchParams.get('scope') ?? '';
    const requested = scope.split(' ');
    expect(requested).not.toContain('https://www.googleapis.com/auth/calendar');
  });
});
