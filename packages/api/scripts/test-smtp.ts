/* eslint-disable no-console */
/**
 * Test SMTP credentials from .env
 *
 * Usage: pnpm tsx scripts/test-smtp.ts [recipient@email.com]
 *
 * Without an argument, verifies the connection only (SMTP EHLO + auth).
 * With an email argument, sends a test email to that address.
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
import nodemailer from 'nodemailer';

// Load .env from monorepo root
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || `Fluxure <noreply@fluxure.app>`;

if (!host || !user || !pass) {
  console.error('Missing SMTP config. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
  process.exit(1);
}

console.log(`SMTP host:  ${host}:${port}`);
console.log(`SMTP user:  ${user}`);
console.log(`SMTP from:  ${from}`);
console.log(`TLS/SSL:    ${port === 465 ? 'implicit (port 465)' : 'STARTTLS'}`);
console.log('');

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
});

try {
  console.log('Verifying connection...');
  await transporter.verify();
  console.log('SMTP connection OK — authenticated successfully.\n');
} catch (err) {
  console.error('SMTP connection FAILED:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const recipient = process.argv[2];

if (!recipient) {
  console.log('Pass an email address as argument to send a test email:');
  console.log('  pnpm tsx scripts/test-smtp.ts you@example.com');
  process.exit(0);
}

try {
  console.log(`Sending test email to ${recipient}...`);
  const info = await transporter.sendMail({
    from,
    to: recipient,
    subject: 'Fluxure SMTP Test',
    text: 'If you received this, your SMTP credentials are working correctly.',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">SMTP Test</h1>
        <p style="color: #555; line-height: 1.6;">If you received this, your SMTP credentials are working correctly.</p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Sent from Fluxure SMTP test script.</p>
      </div>
    `,
  });

  console.log(`Test email sent. Message ID: ${info.messageId}`);
} catch (err) {
  console.error('Failed to send test email:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
