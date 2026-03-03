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

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    log.warn('SMTP not configured — emails will be logged to console');
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    tls: { rejectUnauthorized: true },
    auth: { user, pass },
  });

  return transporter;
}

function getFromAddress(): string {
  return SMTP_FROM;
}

function getAppUrl(): string {
  return FRONTEND_URL;
}

function buildEmailHtml(
  heading: string,
  bodyText: string,
  ctaText: string,
  ctaUrl: string,
  footerText: string,
): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">${escapeHtml(heading)}</h1>
      <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">${escapeHtml(bodyText)}</p>
      <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">${escapeHtml(ctaText)}</a>
      <p style="color: #888; font-size: 13px; margin-top: 32px; line-height: 1.5;">${escapeHtml(footerText)}</p>
    </div>
  `;
}

export async function verifySmtpConnection(): Promise<boolean> {
  if (!transporter || process.env.NODE_ENV !== 'production') return true;
  try {
    await transporter.verify();
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
  const safePassword = escapeHtml(zipPassword);
  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">Your data export is ready</h1>
      <p style="color: #555; line-height: 1.6; margin-bottom: 16px;">Attached is your ${escapeHtml(BRAND.name)} data export. The ZIP file is encrypted.</p>
      <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">Your ZIP password: <strong style="font-family: 'Courier New', Courier, monospace; background: #f3f3f3; padding: 2px 6px; border-radius: 4px;">${safePassword}</strong></p>
      <a href="${escapeHtml(getAppUrl())}" style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Open Fluxure</a>
      <p style="color: #888; font-size: 13px; margin-top: 32px; line-height: 1.5;">This export contains your personal data as requested. If you didn't request this export, please change your password immediately.</p>
    </div>
  `;

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

  if (info.envelope === undefined && info.message) {
    log.info({ to: email, subject: 'Your data export' }, 'Data export email sent (console mode)');
  }
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
    html: buildEmailHtml(
      'Booking Confirmed',
      `Your ${duration}-minute meeting with ${hostName} has been confirmed.`,
      `${formattedTime}`,
      getAppUrl(),
      'If you did not request this booking, you can ignore this email.',
    ),
    text: `Booking Confirmed\n\nYour ${duration}-minute meeting with ${hostName} has been confirmed.\n\nWhen: ${formattedTime}`,
  });

  if (info.envelope === undefined && info.message) {
    log.info(
      { to: email, subject: 'Booking confirmed' },
      'Booking confirmation email sent (console mode)',
    );
  }
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
    html: buildEmailHtml(
      'Account Deleted',
      `Your ${BRAND.name} account (${email}) was deleted on ${formattedDate}. All associated data has been permanently removed.`,
      `Visit ${BRAND.name}`,
      getAppUrl(),
      'If you did not request this deletion, please contact support immediately.',
    ),
    text: `Account Deleted\n\nYour ${BRAND.name} account (${email}) was deleted on ${formattedDate}. All associated data has been permanently removed.\n\nIf you did not request this deletion, please contact support immediately.`,
  });

  if (info.envelope === undefined && info.message) {
    log.info(
      { to: email, subject: 'Account deleted' },
      'Account deletion email sent (console mode)',
    );
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Verify your email - ${BRAND.name}`,
    html: buildEmailHtml(
      'Verify your email',
      `Click the button below to verify your email address and complete your ${BRAND.name} registration.`,
      'Verify Email',
      verifyUrl,
      `This link expires in 24 hours. If you didn't create a ${BRAND.name} account, you can ignore this email.`,
    ),
    text: `Verify your email\n\nVisit this link to verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });

  // Log metadata only when using jsonTransport (no SMTP configured)
  if (info.envelope === undefined && info.message) {
    log.info({ to: email, subject: 'Verify your email' }, 'Verification email sent (console mode)');
  }
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const info = await getTransporter().sendMail({
    from: getFromAddress(),
    to: email,
    subject: `Reset your password - ${BRAND.name}`,
    html: buildEmailHtml(
      'Reset your password',
      `Click the button below to set a new password for your ${BRAND.name} account.`,
      'Reset Password',
      resetUrl,
      `This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.`,
    ),
    text: `Reset your password\n\nVisit this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });

  if (info.envelope === undefined && info.message) {
    log.info(
      { to: email, subject: 'Reset your password' },
      'Password reset email sent (console mode)',
    );
  }
}
