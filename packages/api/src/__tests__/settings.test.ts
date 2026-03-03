import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockForUpdate = vi.fn();
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callbacks
  const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock variadic args
    const txWhere = vi.fn().mockImplementation((...args: any[]) => {
      const result = mockWhere(...args);
      return { for: mockForUpdate.mockReturnValue(result) };
    });
    const txFrom = vi.fn().mockReturnValue({ where: txWhere });
    const tx = {
      select: vi.fn().mockReturnValue({ from: txFrom }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
    };
    return cb(tx);
  });

  return {
    mockDb: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      transaction: mockTransaction,
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockSet: mockSet,
      _mockSetWhere: mockSetWhere,
      _mockTransaction: mockTransaction,
      _mockForUpdate: mockForUpdate,
    },
  };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));

import { createTestApp } from './helpers.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import settingsRouter from '../routes/settings.js';

const app = createTestApp('settings', settingsRouter);

const defaultSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: 'America/New_York',
  schedulingWindowDays: 14,
};

const defaultUser = {
  id: 'test-user-id',
  googleRefreshToken: null,
  googleSyncToken: null,
  settings: defaultSettings,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockWhere.mockResolvedValue([]);
  mockDb._mockSetWhere.mockResolvedValue(undefined);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockSetWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callbacks
  mockDb._mockTransaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock variadic args
    const txWhere = vi.fn().mockImplementation((...args: any[]) => {
      const result = mockDb._mockWhere(...args);
      return { for: mockDb._mockForUpdate.mockReturnValue(result) };
    });
    const txFrom = vi.fn().mockReturnValue({ where: txWhere });
    const tx = {
      select: vi.fn().mockReturnValue({ from: txFrom }),
      update: vi.fn().mockReturnValue({ set: mockDb._mockSet }),
    };
    return cb(tx);
  });
}

describe('GET /api/settings', () => {
  beforeEach(resetMocks);

  it('returns 404 when no user exists', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns user settings', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('test-user-id');
    expect(res.body.settings.timezone).toBe('America/New_York');
    expect(res.body.settings.workingHours.start).toBe('09:00');
  });

  it('returns default settings when user has no settings field', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([{ ...defaultUser, settings: null }]);

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.body.settings.timezone).toBe('America/New_York');
    expect(res.body.settings.schedulingWindowDays).toBe(14);
  });
});

describe('PUT /api/settings', () => {
  beforeEach(resetMocks);

  it('returns 400 with invalid working hours format', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({
        workingHours: { start: 'bad', end: '17:00' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 with invalid schedulingWindowDays (negative)', async () => {
    const res = await request(app).put('/api/settings').send({ schedulingWindowDays: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 when no user exists', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([]);

    const res = await request(app).put('/api/settings').send({ timezone: 'UTC' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('updates settings with valid timezone', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app).put('/api/settings').send({ timezone: 'Europe/London' });

    expect(res.status).toBe(200);
    expect(res.body.settings.timezone).toBe('Europe/London');
  });

  it('merges partial settings update (working hours only)', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app)
      .put('/api/settings')
      .send({ workingHours: { start: '08:00', end: '16:00' } });

    expect(res.status).toBe(200);
    expect(res.body.settings.workingHours.start).toBe('08:00');
    expect(res.body.settings.timezone).toBe('America/New_York');
  });
});

describe('GET /api/settings/google/status', () => {
  beforeEach(resetMocks);

  it('returns connected false when no refresh token', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app).get('/api/settings/google/status');

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it('returns connected true when refresh token exists', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([
      { ...defaultUser, googleRefreshToken: 'encrypted-token' },
    ]);

    const res = await request(app).get('/api/settings/google/status');

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });
});

describe('POST /api/settings/google/disconnect', () => {
  beforeEach(resetMocks);

  it('returns 404 when no user exists', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/settings/google/disconnect');

    expect(res.status).toBe(404);
  });

  it('disconnects Google successfully', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app).post('/api/settings/google/disconnect');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Google disconnected');
  });
});
