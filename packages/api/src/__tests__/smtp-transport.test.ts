import { describe, it, expect, vi } from 'vitest';

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(), verify: vi.fn() })) },
}));
vi.mock('../config.js', () => ({
  SMTP_PORT: 587,
  SMTP_FROM: 'Fluxure <noreply@fluxure.app>',
  FRONTEND_URL: 'http://localhost:5173',
  isSmtpInsecure: () => false,
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { buildSmtpTransportOptions } from '../auth/email.js';

describe('buildSmtpTransportOptions', () => {
  it('requires STARTTLS and verifies certs in production on non-465 ports', () => {
    const opts = buildSmtpTransportOptions({
      host: 'mail.example.com',
      port: 587,
      isProduction: true,
      insecure: false,
    });

    expect(opts.requireTLS).toBe(true);
    expect(opts.tls).toEqual({ rejectUnauthorized: true });
    expect(opts.ignoreTLS).toBeUndefined();
    expect(opts.secure).toBe(false);
  });

  it('disables STARTTLS and cert verification when insecure is set', () => {
    const opts = buildSmtpTransportOptions({
      host: '172.24.0.1',
      port: 25,
      isProduction: true,
      insecure: true,
    });

    expect(opts.ignoreTLS).toBe(true);
    expect(opts.requireTLS).toBeUndefined();
    expect(opts.tls).toEqual({ rejectUnauthorized: false });
  });

  it('uses implicit TLS on port 465 without requireTLS', () => {
    const opts = buildSmtpTransportOptions({
      host: 'mail.example.com',
      port: 465,
      isProduction: true,
      insecure: false,
    });

    expect(opts.secure).toBe(true);
    expect(opts.requireTLS).toBeUndefined();
  });

  it('attaches auth only when both user and pass are provided', () => {
    const withAuth = buildSmtpTransportOptions({
      host: 'mail.example.com',
      port: 587,
      isProduction: false,
      insecure: false,
      user: 'u',
      pass: 'p',
    });
    const noAuth = buildSmtpTransportOptions({
      host: 'mail.example.com',
      port: 587,
      isProduction: false,
      insecure: false,
      user: 'u',
    });

    expect(withAuth.auth).toEqual({ user: 'u', pass: 'p' });
    expect(noAuth.auth).toBeUndefined();
  });
});
