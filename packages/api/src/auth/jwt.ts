import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import type { Response } from 'express';
import type { JwtPayload } from '@fluxure/shared';
import {
  ACCESS_TOKEN_EXPIRY,
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_EXPIRY_MS,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
} from '@fluxure/shared';

let _jwtSecret: string | null = null;

function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  _jwtSecret = secret;
  return secret;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  // Reject tokens missing required fields
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof (decoded as Record<string, unknown>).userId !== 'string' ||
    typeof (decoded as Record<string, unknown>).emailVerified !== 'boolean' ||
    typeof (decoded as Record<string, unknown>).hasGdprConsent !== 'boolean'
  ) {
    throw new Error('Invalid token payload shape');
  }
  return decoded as JwtPayload;
}

export function generateRefreshToken(): string {
  return randomBytes(40).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getRefreshTokenExpiry(): string {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS).toISOString();
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN; // e.g. '.theflyingrat.com' for cross-subdomain

  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

export function setAccessTokenCookie(res: Response, accessToken: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN;

  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

export function getAccessTokenCookieName(): string {
  return ACCESS_TOKEN_COOKIE;
}

export function clearAuthCookies(res: Response): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieDomain = process.env.COOKIE_DOMAIN;
  const commonOpts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...commonOpts, path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...commonOpts, path: REFRESH_TOKEN_COOKIE_PATH });
}
