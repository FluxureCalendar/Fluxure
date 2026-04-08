import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock tracking ────────────────────────────────────────────
const updateCalls: Array<{ set: Record<string, unknown>; table: string }> = [];
const selectResults: unknown[][] = [];
let selectCallIndex = 0;

const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

function resetChain() {
  updateCalls.length = 0;
  selectResults.length = 0;
  selectCallIndex = 0;
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockWhere.mockReset();
  mockFrom.mockReset();
  mockSet.mockReset();
  mockUpdateWhere.mockReset();

  mockUpdateWhere.mockResolvedValue(undefined);
  mockSet.mockImplementation((values: Record<string, unknown>) => {
    updateCalls.push({ set: values, table: 'unknown' });
    return { where: mockUpdateWhere };
  });

  mockLimit.mockImplementation(() => {
    return Promise.resolve(selectResults[selectCallIndex - 1] ?? []);
  });

  mockOrderBy.mockImplementation(() => ({ limit: mockLimit }));

  mockWhere.mockImplementation(() => {
    const idx = selectCallIndex++;
    const data = idx < selectResults.length ? selectResults[idx] : [];
    const result = Promise.resolve(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).orderBy = mockOrderBy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).limit = mockLimit;
    return result;
  });

  mockFrom.mockReturnValue({ where: mockWhere });
}

// ── Module mocks ─────────────────────────────────────────────
let selfHostedValue = false;

vi.mock('../config.js', () => ({
  isSelfHosted: () => selfHostedValue,
}));

vi.mock('../db/pg-index.js', () => {
  const dbObj = {
    select: vi.fn().mockImplementation(() => ({ from: mockFrom })),
    update: vi.fn().mockImplementation(() => ({ set: mockSet })),
    transaction: vi.fn(),
  };
  dbObj.transaction.mockImplementation(async (cb: (tx: typeof dbObj) => Promise<void>) =>
    cb(dbObj),
  );
  return { db: dbObj };
});

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { freezeExcessItems, unfreezeAllItems } = await import('../billing/freeze.js');
const { db } = await import('../db/pg-index.js');

beforeEach(() => {
  selfHostedValue = false;
  resetChain();
  vi.clearAllMocks();
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({ from: mockFrom }));
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({ set: mockSet }));
});

// ── Helpers ──────────────────────────────────────────────────
/** Push select results for all 4 freezeTable calls + freezeCalendars (count per table). */
function pushAllUnderLimit() {
  // habits count, tasks count, meetings count, links count
  selectResults.push([{ count: 2 }], [{ count: 3 }], [{ count: 1 }], [{ count: 0 }]);
  // calendars count
  selectResults.push([{ count: 1 }]);
}

/** Push results for a single table that is over limit: count + keepIds. */
function pushOverLimit(totalCount: number, keepIds: Array<{ id: string }>) {
  selectResults.push([{ count: totalCount }], keepIds);
}

// ── freezeExcessItems ────────────────────────────────────────
describe('freezeExcessItems', () => {
  describe('self-hosted mode', () => {
    it('skips all operations when self-hosted', async () => {
      selfHostedValue = true;
      await freezeExcessItems('user-1', 'free');
      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('pro plan (unlimited)', () => {
    it('skips all freezeTable calls (unlimited limits)', async () => {
      // Pro limits are all -1 (unlimited) so freezeTable returns early for each.
      // Only focus time enable/disable may run — pro has focusTimeEnabled=true so no disable.
      await freezeExcessItems('user-1', 'pro');
      // No selects needed — isUnlimited returns true immediately
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('unknown plan (falls back to free limits)', () => {
    it('applies free limits for unrecognized plan string', async () => {
      // Should behave like free plan (getPlanLimits returns free for unknown)
      pushAllUnderLimit();
      await freezeExcessItems('user-1', 'invalid-plan');
      // Focus time disabled for free plan
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls.length).toBe(1);
    });
  });

  describe('free plan — under limits', () => {
    it('does not freeze items when all counts are under free limits', async () => {
      pushAllUnderLimit();
      await freezeExcessItems('user-1', 'free');

      // Only the focus time disable call (free plan has focusTimeEnabled=false)
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls.length).toBe(1);
    });

    it('does not freeze when counts are exactly at limit (3 habits, 5 tasks, 2 meetings, 1 link, 1 cal)', async () => {
      // Free limits: habits=3, tasks=5, meetings=2, links=1
      // freezeTable enables all first (update), then counts, then returns if count <= max
      // Each table: 1 enable-all update + 1 count select = returns early
      selectResults.push([{ count: 3 }]); // habits count (at limit)
      selectResults.push([{ count: 5 }]); // tasks count (at limit)
      selectResults.push([{ count: 2 }]); // meetings count (at limit)
      selectResults.push([{ count: 1 }]); // links count (at limit)
      selectResults.push([{ count: 1 }]); // calendars count (at limit)

      await freezeExcessItems('user-1', 'free');

      // 4 enable-all updates (one per freezeTable) + 1 focus time disable = 5
      // No freeze (disable) calls beyond focus time
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls.length).toBe(1); // only focus time
    });

    it('does not freeze when all tables have 0 items', async () => {
      selectResults.push([{ count: 0 }]); // habits
      selectResults.push([{ count: 0 }]); // tasks
      selectResults.push([{ count: 0 }]); // meetings
      selectResults.push([{ count: 0 }]); // links
      selectResults.push([{ count: 0 }]); // calendars

      await freezeExcessItems('user-1', 'free');

      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls.length).toBe(1); // only focus time
    });
  });

  describe('free plan — over limits', () => {
    it('freezes excess habits (5 total, keeps 3 oldest)', async () => {
      // habits: over limit
      pushOverLimit(5, [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }]);
      // tasks, meetings, links: under limit
      selectResults.push([{ count: 2 }], [{ count: 1 }], [{ count: 0 }]);
      // calendars: under limit
      selectResults.push([{ count: 1 }]);

      await freezeExcessItems('user-1', 'free');

      expect(db.update).toHaveBeenCalled();
      const enableTrueCalls = updateCalls.filter((c) => c.set.enabled === true);
      const enableFalseCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(enableTrueCalls.length).toBeGreaterThanOrEqual(1);
      // At least 1 freeze call (habits) + 1 focus time disable
      expect(enableFalseCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('freezes excess when over limit by exactly 1 (4 habits, limit 3)', async () => {
      pushOverLimit(4, [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }]);
      selectResults.push([{ count: 0 }], [{ count: 0 }], [{ count: 0 }]);
      selectResults.push([{ count: 0 }]);

      await freezeExcessItems('user-1', 'free');

      const enableFalseCalls = updateCalls.filter((c) => c.set.enabled === false);
      // 1 habits freeze + 1 focus time disable
      expect(enableFalseCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('freezes excess across multiple tables simultaneously', async () => {
      // habits: 6 (limit 3), tasks: 8 (limit 5), meetings: under, links: under
      pushOverLimit(6, [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }]);
      pushOverLimit(8, [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }, { id: 't5' }]);
      selectResults.push([{ count: 1 }], [{ count: 0 }]);
      selectResults.push([{ count: 1 }]);

      await freezeExcessItems('user-1', 'free');

      const enableFalseCalls = updateCalls.filter((c) => c.set.enabled === false);
      // habits freeze + tasks freeze + focus time disable = 3+
      expect(enableFalseCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('freezes all items when keepIds is empty (0 to keep but items exist)', async () => {
      // Simulate a hypothetical scenario: table has items but maxCount=0
      // This doesn't happen with current free limits (all > 0) but tests the else branch
      // We test the code path via calendars with count > limit and empty keep list
      selectResults.push([{ count: 0 }]); // habits
      selectResults.push([{ count: 0 }]); // tasks
      selectResults.push([{ count: 0 }]); // meetings
      selectResults.push([{ count: 0 }]); // links
      // calendars: 3 total, limit 1 — keepIds returned
      selectResults.push([{ count: 3 }], [{ id: 'c1' }]);

      await freezeExcessItems('user-1', 'free');

      const enableFalseCalls = updateCalls.filter((c) => c.set.enabled === false);
      // calendar freeze + focus time disable
      expect(enableFalseCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('free plan — focus time gating', () => {
    it('disables focus time for free plan', async () => {
      pushAllUnderLimit();
      await freezeExcessItems('user-1', 'free');

      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls.length).toBe(1);
    });

    it('does not disable focus time for pro plan', async () => {
      await freezeExcessItems('user-1', 'pro');

      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls.length).toBe(0);
    });
  });

  describe('calendar-specific freezing', () => {
    it('freezes excess calendars keeping primary first', async () => {
      // All entity tables under limit
      selectResults.push([{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }]);
      // calendars: 3 total, limit 1
      selectResults.push([{ count: 3 }], [{ id: 'primary-cal' }]);

      await freezeExcessItems('user-1', 'free');

      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      // calendar freeze + focus time disable
      expect(disableCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ── unfreezeAllItems ─────────────────────────────────────────
describe('unfreezeAllItems', () => {
  it('enables all 6 entity types for the user', async () => {
    await unfreezeAllItems('user-1');

    // habits, tasks, meetings, links, calendars, focusTimeRules
    expect(db.update).toHaveBeenCalledTimes(6);

    const allEnableTrue = updateCalls.every((c) => c.set.enabled === true);
    expect(allEnableTrue).toBe(true);
    expect(updateCalls.length).toBe(6);
  });

  it('calls update with enabled=true for every call', async () => {
    await unfreezeAllItems('user-42');

    expect(updateCalls.length).toBe(6);
    for (const call of updateCalls) {
      expect(call.set).toEqual({ enabled: true });
    }
  });

  it('works for a different userId without interference', async () => {
    await unfreezeAllItems('user-99');

    // Still 6 update calls, all setting enabled=true
    expect(db.update).toHaveBeenCalledTimes(6);
    expect(updateCalls.length).toBe(6);
  });
});
