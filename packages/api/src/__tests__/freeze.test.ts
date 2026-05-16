import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock tracking ────────────────────────────────────────────
/** Each call to tx.update(table).set(payload).where(pred) pushes here */
const updateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];

/** Ordered queue of results for tx.select().from().where().orderBy() */
const selectResults: unknown[][] = [];
let selectCallIndex = 0;

// ── Module mocks ─────────────────────────────────────────────
let selfHostedValue = false;

vi.mock('../config.js', () => ({
  isSelfHosted: () => selfHostedValue,
}));

/**
 * Mock drizzle-orm so that inArray returns an inspectable sentinel
 * { __inArray: ids } while eq/and/asc/desc return simple tagged values.
 * This lets us inspect exactly which ids were passed to each update's .where().
 */
vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof import('drizzle-orm')>();
  return {
    ...actual,
    inArray: (_col: unknown, ids: string[]) => ({ __inArray: ids }),
    eq: (_col: unknown, val: unknown) => ({ __eq: val }),
    and: (...args: unknown[]) => ({ __and: args }),
    asc: (col: unknown) => ({ __asc: col }),
    desc: (col: unknown) => ({ __desc: col }),
  };
});

/**
 * The new freeze.ts always operates inside db.transaction(tx => ...).
 * Every select in reconcileTable / reconcileCalendars resolves from
 * the selectResults queue via tx.select().from().where().orderBy().
 * Every update resolves and records { set, where } in updateCalls.
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

  /** Build a chainable update mock that records .set() payload and .where() predicate */
  function makeUpdateChain() {
    const chain = {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        const whereCapture = vi.fn().mockImplementation((pred: unknown) => {
          updateCalls.push({ set: payload, where: pred });
          return Promise.resolve(undefined);
        });
        return { where: whereCapture };
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

  function makeUpdateChainReset() {
    return {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation((pred: unknown) => {
          updateCalls.push({ set: payload, where: pred });
          return Promise.resolve(undefined);
        }),
      })),
    };
  }

  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => makeUpdateChainReset());
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
        update: vi.fn().mockImplementation(() => makeUpdateChainReset()),
      };
      return cb(tx);
    },
  );
}

beforeEach(resetState);

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract the ids array from a { __inArray: ids } sentinel buried inside
 * the { __and: [...] } predicate that freeze.ts passes to .where().
 * Shape: { __and: [{ __eq: userId }, { __inArray: ids }] }
 */
function extractInArrayIds(wherePred: unknown): string[] {
  if (!wherePred || typeof wherePred !== 'object') return [];
  const pred = wherePred as Record<string, unknown>;
  if ('__and' in pred && Array.isArray(pred.__and)) {
    for (const part of pred.__and as unknown[]) {
      if (part && typeof part === 'object' && '__inArray' in (part as object)) {
        return (part as { __inArray: string[] }).__inArray;
      }
    }
  }
  // Direct inArray (no and wrapper — shouldn't happen in freeze.ts but be safe)
  if ('__inArray' in pred) return pred.__inArray as string[];
  return [];
}

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
    it('issues no frozen=true updates and unfreezes existing rows when limits are unlimited', async () => {
      // With isUnlimited() true for every table, reconcileTable still runs selects and
      // issues frozen:false updates (keepIds === all ids, freezeIds === []).
      // Provide rows per table so the "unlimited → unfreeze all" path is exercised.
      pushSelectsForAllTables(['h1', 'h2'], ['t1'], [], [], ['c1']);
      await freezeExcessItems('user-1', 'pro');

      const frozenTrueCalls = updateCalls.filter((c) => c.set.frozen === true);
      expect(frozenTrueCalls).toHaveLength(0);

      // At least one frozen:false update must have been issued (rows were unfrozen)
      const frozenFalseCalls = updateCalls.filter((c) => c.set.frozen === false);
      expect(frozenFalseCalls.length).toBeGreaterThanOrEqual(1);

      // Pro has focusTimeEnabled=true → no enabled=false call
      const disableCalls = updateCalls.filter((c) => c.set.enabled === false);
      expect(disableCalls).toHaveLength(0);
    });
  });

  describe('free plan — habits 5 total, limit 3', () => {
    it('keeps 3 oldest (frozen=false) and freezes 2 newest (frozen=true) — asserts exact ids', async () => {
      // habits: 5 rows ordered oldest→newest by createdAt: h1..h5
      // reconcileTable orders by asc(createdAt) so the mock returns them in this order.
      // keepIds = ['h1','h2','h3'], freezeIds = ['h4','h5']
      // tasks/meetings/links/calendars: empty
      pushSelectsForAllTables(['h1', 'h2', 'h3', 'h4', 'h5'], [], [], [], []);

      await freezeExcessItems('user-1', 'free');

      // Partition by frozen flag — filter only the habits update calls (not focus-time)
      const frozenFalseCalls = updateCalls.filter(
        (c) => 'frozen' in c.set && c.set.frozen === false,
      );
      const frozenTrueCalls = updateCalls.filter((c) => 'frozen' in c.set && c.set.frozen === true);

      expect(frozenFalseCalls).toHaveLength(1);
      expect(frozenTrueCalls).toHaveLength(1);

      // Assert EXACT ids — the 3 oldest kept, the 2 newest frozen
      const keptIds = extractInArrayIds(frozenFalseCalls[0].where);
      const frozenIds = extractInArrayIds(frozenTrueCalls[0].where);

      expect(new Set(keptIds)).toEqual(new Set(['h1', 'h2', 'h3']));
      expect(new Set(frozenIds)).toEqual(new Set(['h4', 'h5']));

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
    it('always keeps the primary calendar and freezes over-limit non-primary ids — asserts exact ids', async () => {
      // Free limit = 1 calendar. reconcileCalendars orders by isPrimary desc, createdAt asc.
      // The mock returns rows already in that order: primary-cal first, then cal2, cal3.
      // keepIds = ['primary-cal'], freezeIds = ['cal2', 'cal3']
      pushSelectsForAllTables([], [], [], [], ['primary-cal', 'cal2', 'cal3']);

      await freezeExcessItems('user-1', 'free');

      const frozenFalseCalls = updateCalls.filter(
        (c) => 'frozen' in c.set && c.set.frozen === false,
      );
      const frozenTrueCalls = updateCalls.filter((c) => 'frozen' in c.set && c.set.frozen === true);

      // Exactly one frozen=false call (calendar kept) and one frozen=true call (cal2 + cal3)
      expect(frozenFalseCalls).toHaveLength(1);
      expect(frozenTrueCalls).toHaveLength(1);

      // Assert EXACT ids — primary-cal must be in the kept set
      const keptIds = extractInArrayIds(frozenFalseCalls[0].where);
      const frozenIds = extractInArrayIds(frozenTrueCalls[0].where);

      expect(new Set(keptIds)).toEqual(new Set(['primary-cal']));
      expect(new Set(frozenIds)).toEqual(new Set(['cal2', 'cal3']));
    });
  });

  describe('multiple tables over limit simultaneously', () => {
    it('freezes excess habits and tasks, leaving meetings/links/calendars alone', async () => {
      // habits: 6 (limit 3), tasks: 8 (limit 5), rest: under
      // rows are returned oldest-first by the mock, matching reconcileTable's asc(createdAt) order
      const habitIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      const taskIds = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
      pushSelectsForAllTables(habitIds, taskIds, ['m1'], [], ['c1']);

      await freezeExcessItems('user-1', 'free');

      const frozenTrueCalls = updateCalls.filter((c) => c.set.frozen === true);
      // habits: 3 frozen, tasks: 3 frozen → at least 2 separate frozen:true updates
      expect(frozenTrueCalls.length).toBeGreaterThanOrEqual(2);

      // Collect all ids mentioned in frozen:true calls and frozen:false calls
      const allFrozenTrueIds = frozenTrueCalls.flatMap((c) => extractInArrayIds(c.where));
      const frozenFalseCalls = updateCalls.filter((c) => c.set.frozen === false);
      const allFrozenFalseIds = frozenFalseCalls.flatMap((c) => extractInArrayIds(c.where));

      // Identify habit-range and task-range ids from the frozen sets
      const habitRange = new Set(habitIds);
      const taskRange = new Set(taskIds);

      // habits (limit 3): 3 oldest kept as frozen:false, 3 newest frozen:true
      const habitKeptIds = allFrozenFalseIds.filter((id) => habitRange.has(id));
      const habitFrozenIds = allFrozenTrueIds.filter((id) => habitRange.has(id));
      expect(new Set(habitKeptIds)).toEqual(new Set(['h1', 'h2', 'h3']));
      expect(new Set(habitFrozenIds)).toEqual(new Set(['h4', 'h5', 'h6']));

      // tasks (limit 5): 5 oldest kept as frozen:false, 3 newest frozen:true
      const taskKeptIds = allFrozenFalseIds.filter((id) => taskRange.has(id));
      const taskFrozenIds = allFrozenTrueIds.filter((id) => taskRange.has(id));
      expect(new Set(taskKeptIds)).toEqual(new Set(['t1', 't2', 't3', 't4', 't5']));
      expect(new Set(taskFrozenIds)).toEqual(new Set(['t6', 't7', 't8']));
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
