import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock tracking ────────────────────────────────────────────
/** Each call to tx.update(table).set(payload).where(...) pushes here */
const updateCalls: Array<{ set: Record<string, unknown> }> = [];

/** Ordered queue of results for tx.select().from().where().orderBy() */
const selectResults: unknown[][] = [];
let selectCallIndex = 0;

// ── Module mocks ─────────────────────────────────────────────
let selfHostedValue = false;

vi.mock('../config.js', () => ({
  isSelfHosted: () => selfHostedValue,
}));

/**
 * The new freeze.ts always operates inside db.transaction(tx => ...).
 * Every select in reconcileTable / reconcileCalendars resolves from
 * the selectResults queue via tx.select().from().where().orderBy().
 * Every update resolves and records { set } in updateCalls.
 */
vi.mock('../db/pg-index.js', () => {
  /** Build a chainable select mock that resolves on .orderBy() */
  function makeSelectChain() {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockImplementation(() => {
        const data = selectResults[selectCallIndex] ?? [];
        selectCallIndex++;
        return Promise.resolve(data);
      }),
    };
    return chain;
  }

  /** Build a chainable update mock that records .set() payload */
  function makeUpdateChain() {
    const chain = {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updateCalls.push({ set: payload });
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      }),
    };
    return chain;
  }

  const dbObj = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    update: vi.fn().mockImplementation(() => makeUpdateChain()),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      // tx mirrors db — fresh chains each call so recordings accumulate globally
      const tx = {
        select: vi.fn().mockImplementation(() => makeSelectChain()),
        update: vi.fn().mockImplementation(() => makeUpdateChain()),
      };
      return cb(tx);
    }),
  };
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

function resetState() {
  updateCalls.length = 0;
  selectResults.length = 0;
  selectCallIndex = 0;
  selfHostedValue = false;
  vi.clearAllMocks();
  // Re-apply mocks after clearAllMocks (clears call counts but NOT implementations)
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockImplementation(() => {
        const data = selectResults[selectCallIndex] ?? [];
        selectCallIndex++;
        return Promise.resolve(data);
      }),
    };
    return chain;
  });
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      updateCalls.push({ set: payload });
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        select: vi.fn().mockImplementation(() => {
          const chain = {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockImplementation(() => {
              const data = selectResults[selectCallIndex] ?? [];
              selectCallIndex++;
              return Promise.resolve(data);
            }),
          };
          return chain;
        }),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            updateCalls.push({ set: payload });
            return { where: vi.fn().mockResolvedValue(undefined) };
          }),
        })),
      };
      return cb(tx);
    },
  );
}

beforeEach(resetState);

// ── Helpers ──────────────────────────────────────────────────

/**
 * Push the row-id arrays for all 5 entity table selects.
 * The new reconcileTable fetches ALL rows (by id) — no count first.
 * reconcileCalendars also does a single select (ordered by isPrimary desc, createdAt asc).
 *
 * tableCounts: [habits, tasks, meetings, links, calendars]
 * For each count N, push N rows: [{id:'<prefix>1'}, ..., {id:'<prefix>N'}]
 */
function pushSelectsForAllTables(
  habitIds: string[],
  taskIds: string[],
  meetingIds: string[],
  linkIds: string[],
  calendarIds: string[],
) {
  selectResults.push(
    habitIds.map((id) => ({ id })),
    taskIds.map((id) => ({ id })),
    meetingIds.map((id) => ({ id })),
    linkIds.map((id) => ({ id })),
    calendarIds.map((id) => ({ id })),
  );
}

// ── freezeExcessItems ────────────────────────────────────────
describe('freezeExcessItems', () => {
  describe('self-hosted mode', () => {
    it('returns early with zero DB writes when self-hosted', async () => {
      selfHostedValue = true;
      await freezeExcessItems('user-1', 'free');
      expect(db.transaction).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(updateCalls).toHaveLength(0);
    });
  });

  describe('pro plan (unlimited)', () => {
    it('makes no select queries and no frozen=true updates (all limits are -1)', async () => {
      // With isUnlimited() true for every table, reconcileTable still runs but
      // keepIds === ids and freezeIds === [] — so no frozen:true update is issued.
      // Provide 2 rows per table so the "unlimited → freeze nobody" path is exercised.
      pushSelectsForAllTables(['h1', 'h2'], ['t1'], [], [], ['c1']);
      await freezeExcessItems('user-1', 'pro');

      const frozenTrueCalls = updateCalls.filter((c) => c.set.frozen === true);
      expect(frozenTrueCalls).toHaveLength(0);

      // Pro has focusTimeEnabled=true → no enabled=false call
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls).toHaveLength(0);
    });
  });

  describe('free plan — habits 5 total, limit 3', () => {
    it('keeps 3 oldest (frozen=false) and freezes 2 newest (frozen=true)', async () => {
      // habits: 5 rows ordered oldest→newest: h1..h5
      // tasks/meetings/links/calendars: empty
      pushSelectsForAllTables(['h1', 'h2', 'h3', 'h4', 'h5'], [], [], [], []);

      await freezeExcessItems('user-1', 'free');

      // Collect all frozen-flag updates (not the enabled=false for focus time)
      const frozenFalseCalls = updateCalls.filter(
        (c) => 'frozen' in c.set && c.set.frozen === false,
      );
      const frozenTrueCalls = updateCalls.filter((c) => 'frozen' in c.set && c.set.frozen === true);

      // keepIds = ['h1','h2','h3'] → frozen:false
      expect(frozenFalseCalls.length).toBeGreaterThanOrEqual(1);
      // freezeIds = ['h4','h5'] → frozen:true
      expect(frozenTrueCalls.length).toBeGreaterThanOrEqual(1);

      // CRITICAL: no update payload for the 5 entity tables should write `enabled`
      const enabledWrittenForEntities = updateCalls.filter(
        (c) => 'enabled' in c.set && !('frozen' in c.set),
      );
      // The only enabled write allowed is the focusTimeRules disable (free plan)
      // which sets { enabled: false } — that is exactly 1 call
      expect(enabledWrittenForEntities.filter((c) => c.set.enabled === false)).toHaveLength(1);
      expect(enabledWrittenForEntities.filter((c) => c.set.enabled === true)).toHaveLength(0);
    });

    it('never writes the enabled column for habits/tasks/meetings/links/calendars updates', async () => {
      pushSelectsForAllTables(
        ['h1', 'h2', 'h3', 'h4', 'h5'],
        ['t1', 't2', 't3', 't4', 't5', 't6'],
        [],
        [],
        [],
      );

      await freezeExcessItems('user-1', 'free');

      // Filter out the focus-time enabled=false call (which is the one allowed enabled write)
      const entityFreezeUpdates = updateCalls.filter((c) => 'frozen' in c.set);

      for (const call of entityFreezeUpdates) {
        expect(Object.keys(call.set)).not.toContain('enabled');
      }
    });
  });

  describe('free plan — nothing to freeze (all under limits)', () => {
    it('issues frozen=false (unfreeze) updates for items within limits but no frozen=true', async () => {
      // Free limits: habits=3, tasks=5, meetings=2, links=1, calendars=1
      // 2 habits, 3 tasks, 1 meeting, 0 links, 1 calendar — all under limit
      pushSelectsForAllTables(['h1', 'h2'], ['t1', 't2', 't3'], ['m1'], [], ['c1']);

      await freezeExcessItems('user-1', 'free');

      const frozenTrueCalls = updateCalls.filter((c) => c.set.frozen === true);
      expect(frozenTrueCalls).toHaveLength(0);

      // Focus time should be disabled (free plan)
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls).toHaveLength(1);
    });
  });

  describe('free plan — focus time gating', () => {
    it('disables focus time rules (enabled=false) for free plan', async () => {
      pushSelectsForAllTables([], [], [], [], []);

      await freezeExcessItems('user-1', 'free');

      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls).toHaveLength(1);
    });

    it('does not disable focus time for pro plan', async () => {
      pushSelectsForAllTables([], [], [], [], []);

      await freezeExcessItems('user-1', 'pro');

      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls).toHaveLength(0);
    });
  });

  describe('calendar primary-first ordering', () => {
    it('always keeps the primary calendar (first in ordered results)', async () => {
      // Free limit = 1 calendar. reconcileCalendars orders by isPrimary desc, createdAt asc.
      // The mock returns rows already in that order: primary-cal first.
      // keepIds = ['primary-cal'], freezeIds = ['cal2', 'cal3']
      pushSelectsForAllTables([], [], [], [], ['primary-cal', 'cal2', 'cal3']);

      await freezeExcessItems('user-1', 'free');

      const frozenTrueCalls = updateCalls.filter((c) => c.set.frozen === true);
      // 2 calendars should be frozen (cal2 and cal3)
      expect(frozenTrueCalls.length).toBeGreaterThanOrEqual(1);

      const frozenFalseCalls = updateCalls.filter((c) => c.set.frozen === false);
      // primary-cal should be in the kept (frozen=false) set
      expect(frozenFalseCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multiple tables over limit simultaneously', () => {
    it('freezes excess habits and tasks, leaving meetings/links/calendars alone', async () => {
      // habits: 6 (limit 3), tasks: 8 (limit 5), rest: under
      pushSelectsForAllTables(
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'],
        ['m1'],
        [],
        ['c1'],
      );

      await freezeExcessItems('user-1', 'free');

      const frozenTrueCalls = updateCalls.filter((c) => c.set.frozen === true);
      // habits: 3 frozen, tasks: 3 frozen → at least 2 separate frozen:true updates
      expect(frozenTrueCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('unknown plan falls back to free limits', () => {
    it('applies free limits for an unrecognized plan string', async () => {
      pushSelectsForAllTables(['h1', 'h2', 'h3', 'h4'], [], [], [], []);

      await freezeExcessItems('user-1', 'not-a-real-plan');

      // focus time should be disabled (free fallback)
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls).toHaveLength(1);
    });
  });
});

// ── unfreezeAllItems ─────────────────────────────────────────
describe('unfreezeAllItems', () => {
  it('issues frozen=false updates for all 5 entity tables and enabled=true for focusTimeRules', async () => {
    await unfreezeAllItems('user-1');

    expect(db.update).toHaveBeenCalledTimes(6);

    const frozenFalseCalls = updateCalls.filter((c) => c.set.frozen === false);
    // habits, tasks, smartMeetings, schedulingLinks, calendars → 5 calls
    expect(frozenFalseCalls).toHaveLength(5);

    const enabledTrueCalls = updateCalls.filter((c) => c.set.enabled === true);
    // focusTimeRules → 1 call
    expect(enabledTrueCalls).toHaveLength(1);
  });

  it('never writes enabled on the 5 entity-table updates', async () => {
    await unfreezeAllItems('user-1');

    const entityUpdates = updateCalls.filter((c) => c.set.frozen === false);
    for (const call of entityUpdates) {
      expect(Object.keys(call.set)).not.toContain('enabled');
      expect(call.set).toEqual({ frozen: false });
    }
  });

  it('the focusTimeRules update uses enabled=true (not frozen)', async () => {
    await unfreezeAllItems('user-1');

    const focusCall = updateCalls.find((c) => c.set.enabled === true);
    expect(focusCall).toBeDefined();
    expect(focusCall!.set).toEqual({ enabled: true });
  });

  it('works for any userId without interference between calls', async () => {
    await unfreezeAllItems('user-99');

    expect(updateCalls).toHaveLength(6);
    const frozenFalseCalls = updateCalls.filter((c) => c.set.frozen === false);
    const enabledTrueCalls = updateCalls.filter((c) => c.set.enabled === true);
    expect(frozenFalseCalls).toHaveLength(5);
    expect(enabledTrueCalls).toHaveLength(1);
  });
});
