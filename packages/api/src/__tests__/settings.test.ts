import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers.js';

const { mockDb } = vi.hoisted(() => {
  const mockForUpdate = vi.fn();
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });

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
      insert: vi.fn().mockReturnValue({ values: mockValues }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      transaction: mockTransaction,
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockSet: mockSet,
      _mockSetWhere: mockSetWhere,
      _mockTransaction: mockTransaction,
      _mockForUpdate: mockForUpdate,
      _mockReturning: mockReturning,
      _mockValues: mockValues,
      _mockDeleteWhere: mockDeleteWhere,
    },
  };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../cache/user-settings.js', () => ({
  invalidateUserSettingsCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import settingsRouter from '../routes/settings.js';
import schedulingTemplatesRouter from '../routes/scheduling-templates.js';

const app = createTestApp('settings', settingsRouter);
const templatesApp = createTestApp('scheduling-templates', schedulingTemplatesRouter);

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
  emailVerified: true,
  onboardingCompleted: true,
};

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockWhere.mockResolvedValue([]);
  mockDb._mockSetWhere.mockResolvedValue(undefined);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockSetWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
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

// ============================================================
// GET /api/settings
// ============================================================

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

  it('returns googleConnected status based on refresh token', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([
      { ...defaultUser, googleRefreshToken: 'encrypted-token' },
    ]);

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.body.googleConnected).toBe(true);
  });

  it('returns googleConnected false when no refresh token', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.body.googleConnected).toBe(false);
  });
});

// ============================================================
// PUT /api/settings
// ============================================================

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

  it('returns 400 with schedulingWindowDays exceeding max (90)', async () => {
    const res = await request(app).put('/api/settings').send({ schedulingWindowDays: 100 });

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

  it('rejects invalid IANA timezone', async () => {
    const res = await request(app).put('/api/settings').send({ timezone: 'Not/A/Timezone' });

    expect(res.status).toBe(400);
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

  it('invalidates settings cache after update', async () => {
    const { invalidateUserSettingsCache } = await import('../cache/user-settings.js');
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    await request(app).put('/api/settings').send({ timezone: 'UTC' });

    expect(invalidateUserSettingsCache).toHaveBeenCalledWith('test-user-id');
  });

  it('rejects working hours window less than 30 minutes', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ workingHours: { start: '09:00', end: '09:15' } });

    expect(res.status).toBe(400);
  });

  it('updates notification preferences', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app)
      .put('/api/settings')
      .send({ trimCompletedEvents: true, freeSlotOnComplete: false });

    expect(res.status).toBe(200);
    expect(res.body.settings.trimCompletedEvents).toBe(true);
    expect(res.body.settings.freeSlotOnComplete).toBe(false);
  });
});

// ============================================================
// GET /api/settings/google/status (deprecated)
// ============================================================

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

  it('returns deprecation headers', async () => {
    mockDb._mockWhere.mockResolvedValueOnce([defaultUser]);

    const res = await request(app).get('/api/settings/google/status');

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-06-01');
  });
});

// ============================================================
// POST /api/settings/google/disconnect
// ============================================================

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

// ============================================================
// Scheduling Templates CRUD
// ============================================================

describe('GET /api/scheduling-templates', () => {
  beforeEach(resetMocks);

  it('returns empty templates list', async () => {
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await request(templatesApp).get('/api/scheduling-templates');

    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([]);
  });

  it('returns existing templates', async () => {
    const templates = [
      { id: 't-1', userId: 'test-user-id', name: 'Morning', startTime: '06:00', endTime: '12:00' },
      { id: 't-2', userId: 'test-user-id', name: 'Evening', startTime: '18:00', endTime: '22:00' },
    ];
    mockDb._mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(templates),
      }),
    });

    const res = await request(templatesApp).get('/api/scheduling-templates');

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(2);
    expect(res.body.templates[0].name).toBe('Morning');
  });
});

describe('POST /api/scheduling-templates', () => {
  beforeEach(resetMocks);

  it('creates a template with valid data', async () => {
    const newTemplate = {
      id: 't-1',
      userId: 'test-user-id',
      name: 'Morning Block',
      startTime: '06:00',
      endTime: '12:00',
    };
    mockDb._mockWhere.mockResolvedValueOnce([]);
    mockDb._mockReturning.mockResolvedValueOnce([newTemplate]);

    const res = await request(templatesApp)
      .post('/api/scheduling-templates')
      .send({ name: 'Morning Block', startTime: '06:00', endTime: '12:00' });

    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe('Morning Block');
  });

  it('returns 400 for missing name', async () => {
    const res = await request(templatesApp)
      .post('/api/scheduling-templates')
      .send({ startTime: '06:00', endTime: '12:00' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when startTime >= endTime', async () => {
    const res = await request(templatesApp)
      .post('/api/scheduling-templates')
      .send({ name: 'Bad', startTime: '18:00', endTime: '06:00' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid time format', async () => {
    const res = await request(templatesApp)
      .post('/api/scheduling-templates')
      .send({ name: 'Bad', startTime: 'noon', endTime: '18:00' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/scheduling-templates/:id', () => {
  beforeEach(resetMocks);

  it('returns 400 for invalid UUID', async () => {
    const res = await request(templatesApp).delete('/api/scheduling-templates/not-a-uuid');

    expect(res.status).toBe(400);
  });

  it('returns 404 when template not found', async () => {
    mockDb._mockDeleteWhere.mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    });
    mockDb.delete.mockReturnValue({
      where: mockDb._mockDeleteWhere,
    });

    const res = await request(templatesApp).delete(
      '/api/scheduling-templates/00000000-0000-0000-0000-000000000001',
    );

    expect(res.status).toBe(404);
  });

  it('deletes template successfully', async () => {
    mockDb._mockDeleteWhere.mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: '00000000-0000-0000-0000-000000000001' }]),
    });
    mockDb.delete.mockReturnValue({
      where: mockDb._mockDeleteWhere,
    });

    const res = await request(templatesApp).delete(
      '/api/scheduling-templates/00000000-0000-0000-0000-000000000001',
    );

    expect(res.status).toBe(204);
  });
});
