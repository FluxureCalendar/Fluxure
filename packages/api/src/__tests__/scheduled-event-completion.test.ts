import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATUS_PREFIX } from '@fluxure/shared';
import { TEST_USER_ID } from './helpers.js';

// Mock DB: select -> from -> where (row lookup); update -> set -> where (status write)
const { mockDb, mockCalClient, mockSchedulerGet } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockCalClient = { applyOperations: vi.fn().mockResolvedValue([]) };
  const mockSchedulerGet = vi.fn().mockReturnValue(undefined);
  return {
    mockCalClient,
    mockSchedulerGet,
    mockDb: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockSet: mockSet,
      _mockSetWhere: mockSetWhere,
    },
  };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: { get: mockSchedulerGet, getOrCreate: vi.fn(), cancelIdle: vi.fn() },
}));
vi.mock('../routes/schedule-helpers.js', () => ({
  getUserSettings: vi.fn().mockResolvedValue({ trimCompletedEvents: false, timezone: 'UTC' }),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { syncScheduledHabitEventCompleted } from '../services/scheduled-event-completion.js';

const HABIT_ID = '11111111-1111-1111-1111-111111111111';
const SCHEDULED_DATE = '2026-05-17';
const ITEM_ID = `${HABIT_ID}__${SCHEDULED_DATE}`;

function habitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    userId: TEST_USER_ID,
    itemType: 'habit',
    itemId: ITEM_ID,
    title: 'Morning Run',
    googleEventId: 'gcal-evt-1',
    calendarId: null,
    start: '2026-05-17T11:00:00.000Z',
    end: '2026-05-17T12:00:00.000Z',
    status: 'free',
    ...overrides,
  };
}

describe('syncScheduledHabitEventCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._mockWhere.mockResolvedValue([]);
    mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
    mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
    mockDb._mockSet.mockReturnValue({ where: mockDb._mockSetWhere });
    mockDb._mockSetWhere.mockResolvedValue(undefined);
    mockDb.update.mockReturnValue({ set: mockDb._mockSet });
    mockSchedulerGet.mockReturnValue(undefined);
    mockCalClient.applyOperations.mockResolvedValue([]);
  });

  it('sets the scheduled event status to completed and syncs the ✅ prefix to Google', async () => {
    mockDb._mockWhere.mockResolvedValue([habitRow()]);
    mockSchedulerGet.mockReturnValue({ getCalClient: () => mockCalClient });

    await syncScheduledHabitEventCompleted(TEST_USER_ID, HABIT_ID, SCHEDULED_DATE);

    expect(mockDb.update).toHaveBeenCalled();
    const setPayload = mockDb._mockSet.mock.calls[0][0] as { status?: string };
    expect(setPayload.status).toBe('completed');

    expect(mockCalClient.applyOperations).toHaveBeenCalledTimes(1);
    const ops = mockCalClient.applyOperations.mock.calls[0][1] as Array<{ title: string }>;
    expect(ops[0].title.startsWith(STATUS_PREFIX.completed)).toBe(true);
  });

  it('is idempotent: does nothing when the event is already completed', async () => {
    mockDb._mockWhere.mockResolvedValue([habitRow({ status: 'completed' })]);
    mockSchedulerGet.mockReturnValue({ getCalClient: () => mockCalClient });

    await syncScheduledHabitEventCompleted(TEST_USER_ID, HABIT_ID, SCHEDULED_DATE);

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockCalClient.applyOperations).not.toHaveBeenCalled();
  });

  it('still marks completed in the DB when Google is not connected (no calClient)', async () => {
    mockDb._mockWhere.mockResolvedValue([habitRow()]);
    mockSchedulerGet.mockReturnValue(undefined);

    await expect(
      syncScheduledHabitEventCompleted(TEST_USER_ID, HABIT_ID, SCHEDULED_DATE),
    ).resolves.not.toThrow();

    expect(mockDb.update).toHaveBeenCalled();
    const setPayload = mockDb._mockSet.mock.calls[0][0] as { status?: string };
    expect(setPayload.status).toBe('completed');
  });

  it('does nothing when no matching scheduled event row exists', async () => {
    mockDb._mockWhere.mockResolvedValue([]);

    await syncScheduledHabitEventCompleted(TEST_USER_ID, HABIT_ID, SCHEDULED_DATE);

    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
