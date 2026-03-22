import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { BRAND } from '@fluxure/shared';
import { SMTP_PORT, SMTP_FROM, FRONTEND_URL } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('email');

/** Escape HTML special characters to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let transporter: Transporter | null = null;
let isJsonTransport = false;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    log.warn('SMTP not configured — emails will be logged to console');
    isJsonTransport = true;
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return transporter;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const opts: Record<string, unknown> = {
    host,
    port,
    secure: port === 465,
    // In production, require STARTTLS on non-465 ports; in dev, use opportunistic TLS
    // so local servers like Mailpit that don't support STARTTLS still work
    ...(isProduction && port !== 465 ? { requireTLS: true } : {}),
    tls: { rejectUnauthorized: isProduction },
  };

  if (user && pass) {
    opts.auth = { user, pass };
  }

  transporter = nodemailer.createTransport(opts as nodemailer.TransportOptions);

  return transporter;
}

/** In dev (jsonTransport), log the email content so you can see what would have been sent. */
function logDevEmail(info: { message?: string }): void {
  if (!isJsonTransport || !info.message) return;
  try {
    const parsed = JSON.parse(info.message);
    log.info(
      {
        to: parsed.to,
        subject: parsed.subject,
        text: parsed.text,
        hasAttachments: (parsed.attachments?.length ?? 0) > 0,
      },
      'Email (dev mode — not sent)',
    );
  } catch {
    log.info({ raw: info.message }, 'Email (dev mode — not sent)');
  }
}

function getFromAddress(): string {
  return SMTP_FROM;
}

function getAppUrl(): string {
  return FRONTEND_URL;
}

interface EmailOptions {
  heading: string;
  bodyText: string;
  ctaText?: string;
  ctaUrl?: string;
  footerText: string;
  /** Optional HTML to insert between body and CTA (e.g. info box, code block) */
  extraHtml?: string;
}

function buildEmailHtml(options: EmailOptions): string {
  const { heading, bodyText, ctaText, ctaUrl, footerText, extraHtml } = options;

  const ctaBlock =
    ctaText && ctaUrl
      ? `<tr><td style="padding-top: 24px;">
          <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; background: #3D8FA4; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">${escapeHtml(ctaText)}</a>
        </td></tr>`
      : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding: 40px 20px;">
  <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px; width: 100%;">
    <tr><td style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <p style="margin: 0 0 32px 0; font-size: 20px; font-weight: 600; color: #3D8FA4; letter-spacing: -0.01em;">${escapeHtml(BRAND.name)}</p>
      <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 600; color: #1E2D35;">${escapeHtml(heading)}</h1>
      <p style="margin: 0; color: #5B7B8A; font-size: 15px; line-height: 1.6;">${escapeHtml(bodyText)}</p>
      ${extraHtml ?? ''}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        ${ctaBlock}
      </table>
      <p style="margin: 32px 0 0 0; color: #6B8898; font-size: 12px; line-height: 1.5;">${escapeHtml(footerText)}</p>
      <p style="margin: 8px 0 0 0; color: #9BB0BC; font-size: 12px;">${escapeHtml(BRAND.name)} &mdash; ${escapeHtml(BRAND.tagline)}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

export async function verifySmtpConnection(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true;
  const t = getTransporter();
  if (isJsonTransport) return true; // No real SMTP configured
  try {
    await t.verify();
    return true;
  } catch (err) {
    log.warn({ err }, 'SMTP connection failed — emails will not be sent');
    return false;
  }
}

export async function sendDataExportEmail(
  email: string,
  zipBuffer: Buffer,
  zipPassword: string,
): Promise<void> {
  const passwordBlock = `<p style="margin: 16px 0 0 0; color: #5B7B8A; font-size: 15px; line-height: 1.6;">Your ZIP password: <strong style="font-family: 'Courier New', Courier, monospace; background: #EEF3F6; padding: 3px 8px; border-radius: 4px; color: #1E2D35;">${escapeHtml(zipPassword)}</strong></p>`;

  const htmlBody = buildEmailHtml({
    heading: 'Your data export is ready',
    bodyText: `Attached is your ${BRAND.name} data export. The ZIP file is encrypted.`,
    extraHtml: passwordBlock,
    ctaText: `Open ${BRAND.name}`,
    ctaUrl: getAppUrl(),
    footerText: `This export contains your personal data as requested. If you didn't request this export, please change your password immediately.`,
  });

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Your data export - ${BRAND.name}`,
    html: htmlBody,
    text: `Your data export is ready\n\nAttached is your ${BRAND.name} data export. The ZIP file is encrypted.\n\nYour ZIP password: ${zipPassword}\n\nIf you didn't request this export, please change your password immediately.`,
    attachments: [
      {
        filename: 'fluxure-data-export.zip',
        content: zipBuffer,
        contentType: 'application/zip',
      },
    ],
  });

  logDevEmail(info);
}

export async function sendBookingConfirmation(
  email: string,
  details: { hostName: string; dateTime: string; duration: number; timezone: string },
): Promise<void> {
  const { hostName, dateTime, duration, timezone } = details;
  const formattedTime = new Date(dateTime).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Booking confirmed with ${escapeHtml(hostName)}`,
    html: buildEmailHtml({
      heading: 'Booking Confirmed',
      bodyText: `Your ${duration}-minute meeting with ${hostName} has been confirmed.`,
      extraHtml: `<p style="margin: 16px 0 0 0; padding: 12px 16px; background: #F5F8FA; border-left: 3px solid #3D8FA4; border-radius: 4px; color: #1E2D35; font-size: 14px; line-height: 1.6;">${escapeHtml(formattedTime)}<br><span style="color: #5B7B8A;">${duration} minutes with ${escapeHtml(hostName)}</span></p>`,
      ctaText: `Open ${BRAND.name}`,
      ctaUrl: getAppUrl(),
      footerText: 'If you did not request this booking, you can ignore this email.',
    }),
    text: `Booking Confirmed\n\nYour ${duration}-minute meeting with ${hostName} has been confirmed.\n\nWhen: ${formattedTime}`,
  });

  logDevEmail(info);
}

export async function sendAccountDeletionEmail(email: string, deletedAt: string): Promise<void> {
  const formattedDate = new Date(deletedAt).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Account deleted - ${BRAND.name}`,
    html: buildEmailHtml({
      heading: 'Account Deleted',
      bodyText: `Your ${BRAND.name} account (${email}) was deleted on ${formattedDate}. All associated data has been permanently removed.`,
      ctaText: `Visit ${BRAND.name}`,
      ctaUrl: getAppUrl(),
      footerText: 'If you did not request this deletion, please contact support immediately.',
    }),
    text: `Account Deleted\n\nYour ${BRAND.name} account (${email}) was deleted on ${formattedDate}. All associated data has been permanently removed.\n\nIf you did not request this deletion, please contact support immediately.`,
  });

  logDevEmail(info);
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Verify your email - ${BRAND.name}`,
    html: buildEmailHtml({
      heading: 'Verify your email',
      bodyText: `Click the button below to verify your email address and complete your ${BRAND.name} registration.`,
      ctaText: 'Verify Email',
      ctaUrl: verifyUrl,
      footerText: `This link expires in 24 hours. If you didn't create a ${BRAND.name} account, you can ignore this email.`,
    }),
    text: `Verify your email\n\nVisit this link to verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });

  logDevEmail(info);
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Reset your password - ${BRAND.name}`,
    html: buildEmailHtml({
      heading: 'Reset your password',
      bodyText: `Click the button below to set a new password for your ${BRAND.name} account.`,
      ctaText: 'Reset Password',
      ctaUrl: resetUrl,
      footerText: `This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.`,
    }),
    text: `Reset your password\n\nVisit this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });

  logDevEmail(info);
}
