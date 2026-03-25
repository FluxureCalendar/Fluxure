import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  createTestAppWithPlan,
  createMockCalendar,
  createMockUser,
  TEST_USER_ID,
  TEST_UUID_1,
  TEST_UUID_2,
} from './helpers.js';

// ── Inline mock DB (vi.hoisted requirement) ──────────────────
const { mockDb, mockGoogleClient } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

  let whereResults: unknown[][] = [[]];
  let whereCallIndex = 0;
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    (result as any).limit = mockLimit;
    (result as any).orderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    return result;
  }

  function makeLimitResult(data: unknown[]) {
    const result = { offset: mockOffset };
    mockOffset.mockResolvedValue(data);
    return result;
  }

  mockWhere.mockImplementation(() => {
    const idx = whereCallIndex++;
    const data = idx < whereResults.length ? whereResults[idx] : [];
    mockLimit.mockReturnValue(makeLimitResult(data));
    return makeWhereResult(data);
  });

  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        insert: vi.fn().mockReturnValue({ values: mockValues }),
        update: vi.fn().mockReturnValue({ set: mockSet }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      };
      return fn(tx);
    }),
    _mockWhere: mockWhere,
    _mockFrom: mockFrom,
    _mockValues: mockValues,
    _mockReturning: mockReturning,
    _mockSet: mockSet,
    _mockWhereReturning: mockWhereReturning,
    _mockDeleteWhere: mockDeleteWhere,
    _mockLimit: mockLimit,
    _mockOffset: mockOffset,
    _setWhereResults: (results: unknown[][]) => {
      whereResults = results;
      whereCallIndex = 0;
    },
  };

  const mockGoogleClient = {
    listCalendars: vi.fn().mockResolvedValue([]),
  };

  return { mockDb, mockGoogleClient };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../google/index.js', () => ({
  createOAuth2Client: vi.fn().mockReturnValue({}),
  setCredentials: vi.fn(),
  GoogleCalendarClient: class {
    listCalendars = mockGoogleClient.listCalendars;
  },
}));
vi.mock('../crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue('decrypted-token'),
}));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    getOrCreate: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockReturnValue(undefined),
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
  },
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import calendarsRouter from '../routes/calendars.js';

const app = createTestApp('calendars', calendarsRouter);

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

// ─── GET /api/calendars ──────────────────────────────────────────

describe('GET /api/calendars', () => {
  beforeEach(resetMocks);

  it('returns empty list when no calendars', async () => {
    mockDb._setWhereResults([[]]);
    const res = await request(app).get('/api/calendars');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns calendars sorted with primary first', async () => {
    const primary = createMockCalendar({ id: 'c1', name: 'Primary', isPrimary: true });
    const secondary = createMockCalendar({ id: 'c2', name: 'Work', isPrimary: false });
    mockDb._setWhereResults([[secondary, primary]]);

    const res = await request(app).get('/api/calendars');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].isPrimary).toBe(true);
    expect(res.body[1].name).toBe('Work');
  });
});

// ─── GET /api/calendars/discover ─────────────────────────────────

describe('GET /api/calendars/discover', () => {
  beforeEach(resetMocks);

  it('returns 400 when Google not connected', async () => {
    const user = createMockUser({ googleRefreshToken: null });
    mockDb._setWhereResults([[user]]);

    const res = await request(app).get('/api/calendars/discover');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Google Calendar not connected/);
  });

  it('discovers and upserts Google calendars', async () => {
    const user = createMockUser({ googleRefreshToken: 'encrypted-token' });
    const googleCals = [
      { googleCalendarId: 'primary@gmail.com', name: 'Primary', color: '#4285f4', isPrimary: true },
      { googleCalendarId: 'work@gmail.com', name: 'Work', color: '#0b8043', isPrimary: false },
    ];
    mockGoogleClient.listCalendars.mockResolvedValue(googleCals);

    const finalList = [
      createMockCalendar({
        googleCalendarId: 'primary@gmail.com',
        name: 'Primary',
        isPrimary: true,
      }),
      createMockCalendar({
        id: 'c2',
        googleCalendarId: 'work@gmail.com',
        name: 'Work',
        isPrimary: false,
      }),
    ];
    // First where: user lookup, second where: existing calendars, third where: final list
    mockDb._setWhereResults([[user], [], finalList]);

    // The discover route calls insert().values() without .returning() inside Promise.all(),
    // so values() must return a thenable (Promise-like) for new calendars.
    mockDb._mockValues.mockReturnValue(Promise.resolve());

    const res = await request(app).get('/api/calendars/discover');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns 400 when user not found', async () => {
    mockDb._setWhereResults([[]]);
    const res = await request(app).get('/api/calendars/discover');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Google Calendar not connected/);
  });
});

// ─── PATCH /api/calendars/:id ────────────────────────────────────

describe('PATCH /api/calendars/:id', () => {
  beforeEach(resetMocks);

  const VALID_CAL_ID = TEST_UUID_2;

  it('returns 400 for invalid UUID', async () => {
    const res = await request(app).patch('/api/calendars/not-a-uuid').send({ enabled: false });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid body', async () => {
    const res = await request(app)
      .patch(`/api/calendars/${VALID_CAL_ID}`)
      .send({ mode: 'invalid-mode' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when calendar not found', async () => {
    mockDb._setWhereResults([[]]);
    const res = await request(app).patch(`/api/calendars/${VALID_CAL_ID}`).send({ enabled: false });
    expect(res.status).toBe(404);
  });

  it('returns 400 when trying to disable primary calendar', async () => {
    const primary = createMockCalendar({ id: VALID_CAL_ID, isPrimary: true });
    mockDb._setWhereResults([[primary]]);

    const res = await request(app).patch(`/api/calendars/${VALID_CAL_ID}`).send({ enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot disable the primary calendar/);
  });

  it('returns 400 when trying to lock primary calendar', async () => {
    const primary = createMockCalendar({ id: VALID_CAL_ID, isPrimary: true });
    mockDb._setWhereResults([[primary]]);

    const res = await request(app).patch(`/api/calendars/${VALID_CAL_ID}`).send({ mode: 'locked' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot lock the primary calendar/);
  });

  it('updates calendar mode successfully', async () => {
    const cal = createMockCalendar({ id: VALID_CAL_ID, isPrimary: false, mode: 'writable' });
    const anotherWritable = createMockCalendar({
      id: TEST_UUID_1,
      isPrimary: true,
      mode: 'writable',
      enabled: true,
    });
    const updatedCal = createMockCalendar({ id: VALID_CAL_ID, mode: 'locked', isPrimary: false });

    // 1st where: existing calendar, 2nd where: all calendars (writable check), 3rd where: updated result
    mockDb._setWhereResults([[cal], [anotherWritable, cal], [updatedCal]]);

    const res = await request(app).patch(`/api/calendars/${VALID_CAL_ID}`).send({ mode: 'locked' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('locked');
  });

  it('returns 400 when disabling the last writable calendar', async () => {
    const cal = createMockCalendar({
      id: VALID_CAL_ID,
      isPrimary: false,
      mode: 'writable',
      enabled: true,
    });
    // Only one calendar exists and it's the one being disabled
    mockDb._setWhereResults([[cal], [cal]]);

    const res = await request(app).patch(`/api/calendars/${VALID_CAL_ID}`).send({ enabled: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/At least one writable calendar must remain enabled/);
  });

  it('enforces plan limit when enabling a calendar', async () => {
    const cal = createMockCalendar({ id: VALID_CAL_ID, isPrimary: false, enabled: false });
    // 1st where: existing lookup, 2nd where: count of enabled calendars
    mockDb._setWhereResults([[cal], [{ count: 2 }]]);

    // Free plan maxCalendars = 2
    const res = await request(app).patch(`/api/calendars/${VALID_CAL_ID}`).send({ enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxCalendars');
  });
});
