import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });

  return {
    mockDb: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      insert: vi.fn().mockReturnValue({ values: mockValues }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callback
      transaction: vi.fn().mockImplementation(async (cb: any) =>
        cb({
          select: vi.fn().mockReturnValue({ from: mockFrom }),
          insert: vi.fn().mockReturnValue({ values: mockValues }),
          update: vi.fn().mockReturnValue({ set: mockSet }),
          delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
        }),
      ),
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockValues: mockValues,
      _mockReturning: mockReturning,
      _mockSet: mockSet,
      _mockSetWhere: mockSetWhere,
      _mockDeleteWhere: mockDeleteWhere,
      _mockOrderBy: mockOrderBy,
      _mockLimit: mockLimit,
    },
  };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));

vi.mock('@fluxure/engine', () => ({
  reschedule: vi.fn().mockReturnValue({ operations: [], unschedulable: [] }),
  generateCandidateSlots: vi.fn().mockReturnValue([]),
  scoreSlot: vi.fn().mockReturnValue(0),
  buildTimeline: vi.fn().mockReturnValue([]),
  calculateScheduleQuality: vi.fn().mockReturnValue({ overall: 100 }),
}));

vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    get: vi.fn().mockReturnValue(undefined),
    getOrCreate: vi.fn().mockRejectedValue(new Error('Google not connected')),
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
  },
}));

import { createTestApp } from './helpers.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import scheduleRouter from '../routes/schedule.js';

const app = createTestApp('schedule', scheduleRouter);

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockWhere.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockSetWhere });
  mockDb._mockSetWhere.mockResolvedValue(undefined);
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

describe('GET /api/schedule', () => {
  beforeEach(resetMocks);

  it('returns empty array when no events exist', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).get('/api/schedule');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns 400 for invalid start date', async () => {
    const res = await request(app).get('/api/schedule?start=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns 400 for invalid end date', async () => {
    const res = await request(app).get('/api/schedule?start=2026-01-01T00:00:00Z&end=not-a-date');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns managed events filtered by date range', async () => {
    const managedEvents = [
      {
        id: 'ev-1',
        itemType: 'habit',
        itemId: 'h-1',
        userId: 'test-user-id',
        googleEventId: null,
        calendarId: 'primary',
        start: '2026-03-05T09:00:00Z',
        end: '2026-03-05T10:00:00Z',
        status: 'free',
        title: 'Morning Run',
        alternativeSlotsCount: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    mockDb._mockWhere.mockResolvedValueOnce([]).mockResolvedValueOnce(managedEvents);

    const res = await request(app).get(
      '/api/schedule?start=2026-03-01T00:00:00Z&end=2026-03-31T00:00:00Z',
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe('ev-1');
    expect(res.body[0].calendarId).toBe('primary');
  });

  it('returns events without date filter (returns all)', async () => {
    const managedEvents = [
      {
        id: 'ev-1',
        itemType: 'habit',
        itemId: 'h-1',
        userId: 'test-user-id',
        googleEventId: null,
        calendarId: null,
        start: '2026-03-05T09:00:00Z',
        end: '2026-03-05T10:00:00Z',
        status: 'free',
        title: 'Test Event',
      },
    ];

    mockDb._mockWhere.mockResolvedValueOnce([]).mockResolvedValueOnce(managedEvents);

    const res = await request(app).get('/api/schedule');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].calendarId).toBe('primary');
  });
});

describe('POST /api/schedule/reschedule', () => {
  beforeEach(resetMocks);

  it('runs reschedule and returns result', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    const res = await request(app).post('/api/schedule/reschedule');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reschedule complete');
    expect(res.body.operationsApplied).toBe(0);
    expect(res.body.unschedulable).toEqual([]);
  });
});
