import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: vi.fn().mockResolvedValue(true),
    })),
  },
}));
vi.mock('../config.js', () => ({
  SMTP_PORT: 587,
  SMTP_FROM: 'Fluxure <noreply@fluxure.app>',
  FRONTEND_URL: 'http://localhost:5173',
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { sendWelcomeEmail } from '../auth/email.js';

beforeEach(() => {
  mockSendMail.mockReset();
  mockSendMail.mockResolvedValue({ message: '{}' });
});

describe('sendWelcomeEmail', () => {
  it('sends a personalized welcome email using the first name', async () => {
    await sendWelcomeEmail('user@example.com', 'Ada Lovelace');

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const arg = mockSendMail.mock.calls[0][0] as Record<string, string>;
    expect(arg.to).toBe('user@example.com');
    expect(arg.subject).toContain('Welcome');
    expect(arg.html).toContain('Welcome, Ada');
    expect(arg.text).toContain('Welcome');
    expect(arg.from).toBe('Fluxure <noreply@fluxure.app>');
  });

  it('falls back to a generic greeting when name is null', async () => {
    await sendWelcomeEmail('user@example.com', null);

    const arg = mockSendMail.mock.calls[0][0] as Record<string, string>;
    expect(arg.html).toContain('Welcome to');
    expect(arg.html).not.toContain('Welcome, ');
  });

  it('escapes HTML in the name to prevent injection', async () => {
    await sendWelcomeEmail('user@example.com', '<script>x</script>');

    const arg = mockSendMail.mock.calls[0][0] as Record<string, string>;
    expect(arg.html).not.toContain('<script>x</script>');
    expect(arg.html).toContain('&lt;script&gt;');
  });
});
