import { describe, it, expect, vi, beforeEach } from 'vitest';
import { daysFromNow, hoursFromNow } from './helpers.js';

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ── Mock setup for revertExpiredTrials ───────────────────────
/**
 * The bulk-update (first db.update call) uses: set → where → returning
 * The stage-3 conditional update (subsequent calls) uses: set → where (no returning)
 *
 * We track all update calls so new tests can assert the conditional stage-3 WHERE.
 */
/** Tracks every db.update().set(payload).where(pred) call after the first (bulk) call. */
const stageUpdateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];

/** Rows returned by the bulk update's .returning(). Configurable per test. */
let bulkReturnRows: unknown[] = [];

vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => ({ __eq: val }),
    and: (...args: unknown[]) => ({ __and: args }),
    isNull: (_col: unknown) => ({ __isNull: true }),
    lte: (_col: unknown, val: unknown) => ({ __lte: val }),
  };
});

vi.mock('../db/pg-index.js', () => {
  let callCount = 0;

  function makeBulkChain() {
    const whereResult = {
      returning: vi.fn().mockImplementation(() => Promise.resolve(bulkReturnRows)),
    };
    return {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(whereResult),
      }),
    };
  }

  function makeStageChain() {
    return {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation((pred: unknown) => {
          stageUpdateCalls.push({ set: payload, where: pred });
          return Promise.resolve(undefined);
        }),
      })),
    };
  }

  return {
    db: {
      update: vi.fn().mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? makeBulkChain() : makeStageChain();
      }),
    },
  };
});

vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
}));

vi.mock('../billing/freeze.js', () => ({
  freezeExcessItems: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../auth/email.js', () => ({
  sendTrialEndedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const {
  isTrialActive,
  getEffectivePlan,
  getTrialDaysRemaining,
  getTrialEndDate,
  revertExpiredTrials,
} = await import('../billing/trial.js');
const { db } = await import('../db/pg-index.js');
const { broadcastToUser } = await import('../ws.js');
const { freezeExcessItems } = (await import('../billing/freeze.js')) as unknown as {
  freezeExcessItems: ReturnType<typeof vi.fn>;
};
const { sendTrialEndedEmail } = (await import('../auth/email.js')) as unknown as {
  sendTrialEndedEmail: ReturnType<typeof vi.fn>;
};

function resetMocks(rows: unknown[] = []) {
  bulkReturnRows = rows;
  stageUpdateCalls.length = 0;
  vi.clearAllMocks();

  let callCount = 0;

  function makeBulkChain() {
    const whereResult = {
      returning: vi.fn().mockImplementation(() => Promise.resolve(bulkReturnRows)),
    };
    return {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(whereResult),
      }),
    };
  }

  function makeStageChain() {
    return {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation((pred: unknown) => {
          stageUpdateCalls.push({ set: payload, where: pred });
          return Promise.resolve(undefined);
        }),
      })),
    };
  }

  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
    callCount += 1;
    return callCount === 1 ? makeBulkChain() : makeStageChain();
  });

  freezeExcessItems.mockResolvedValue(undefined);
  sendTrialEndedEmail.mockResolvedValue(undefined);
}

beforeEach(() => resetMocks([]));

// ── getTrialEndDate ──────────────────────────────────────────
describe('getTrialEndDate', () => {
  it('returns a date 14 days in the future', () => {
    const result = new Date(getTrialEndDate()).getTime();
    const expected = Date.now() + 14 * 24 * 60 * 60 * 1000;
    // Allow 1 second tolerance for execution time
    expect(Math.abs(result - expected)).toBeLessThan(1000);
  });

  it('returns a valid ISO string', () => {
    const result = getTrialEndDate();
    expect(new Date(result).toISOString()).toBe(result);
  });

  it('returns a date in the future', () => {
    const result = new Date(getTrialEndDate());
    expect(result.getTime()).toBeGreaterThan(Date.now());
  });
});

// ── isTrialActive ────────────────────────────────────────────
describe('isTrialActive', () => {
  it('returns true: pro plan, future planPeriodEnd, no stripe subscription', () => {
    expect(
      isTrialActive({ plan: 'pro', planPeriodEnd: daysFromNow(10), stripeSubscriptionId: null }),
    ).toBe(true);
  });

  it('returns true: trial just started today (14 days remaining)', () => {
    expect(
      isTrialActive({ plan: 'pro', planPeriodEnd: daysFromNow(14), stripeSubscriptionId: null }),
    ).toBe(true);
  });

  it('returns true: trial expiring in 1 minute (still active)', () => {
    expect(
      isTrialActive({
        plan: 'pro',
        planPeriodEnd: minutesFromNow(1),
        stripeSubscriptionId: null,
      }),
    ).toBe(true);
  });

  it('returns false: planPeriodEnd in past (expired trial)', () => {
    expect(
      isTrialActive({ plan: 'pro', planPeriodEnd: daysFromNow(-1), stripeSubscriptionId: null }),
    ).toBe(false);
  });

  it('returns false: planPeriodEnd just expired (1 minute ago)', () => {
    expect(
      isTrialActive({
        plan: 'pro',
        planPeriodEnd: minutesFromNow(-1),
        stripeSubscriptionId: null,
      }),
    ).toBe(false);
  });

  it('returns false: pro plan with stripeSubscriptionId (paid, not trial)', () => {
    expect(
      isTrialActive({
        plan: 'pro',
        planPeriodEnd: daysFromNow(10),
        stripeSubscriptionId: 'sub_123',
      }),
    ).toBe(false);
  });

  it('returns false: free plan', () => {
    expect(isTrialActive({ plan: 'free', planPeriodEnd: null, stripeSubscriptionId: null })).toBe(
      false,
    );
  });

  it('returns false: free plan even with future planPeriodEnd', () => {
    expect(
      isTrialActive({ plan: 'free', planPeriodEnd: daysFromNow(10), stripeSubscriptionId: null }),
    ).toBe(false);
  });

  it('returns false: pro plan but planPeriodEnd is null', () => {
    expect(isTrialActive({ plan: 'pro', planPeriodEnd: null, stripeSubscriptionId: null })).toBe(
      false,
    );
  });
});

// ── getEffectivePlan ─────────────────────────────────────────
describe('getEffectivePlan', () => {
  it('returns pro when trial is active (pro, future end, no stripe)', () => {
    expect(
      getEffectivePlan({ plan: 'pro', planPeriodEnd: daysFromNow(10), stripeSubscriptionId: null }),
    ).toBe('pro');
  });

  it('returns free when trial expired (pro, past end, no stripe)', () => {
    expect(
      getEffectivePlan({
        plan: 'pro',
        planPeriodEnd: daysFromNow(-1),
        stripeSubscriptionId: null,
      }),
    ).toBe('free');
  });

  it('returns pro when paid subscriber (has stripeSubscriptionId)', () => {
    expect(
      getEffectivePlan({
        plan: 'pro',
        planPeriodEnd: daysFromNow(30),
        stripeSubscriptionId: 'sub_123',
      }),
    ).toBe('pro');
  });

  it('returns pro for paid subscriber even with past planPeriodEnd', () => {
    expect(
      getEffectivePlan({
        plan: 'pro',
        planPeriodEnd: daysFromNow(-5),
        stripeSubscriptionId: 'sub_456',
      }),
    ).toBe('pro');
  });

  it('returns free when plan is free', () => {
    expect(
      getEffectivePlan({ plan: 'free', planPeriodEnd: null, stripeSubscriptionId: null }),
    ).toBe('free');
  });

  it('returns free when pro but planPeriodEnd is null and no stripe', () => {
    expect(getEffectivePlan({ plan: 'pro', planPeriodEnd: null, stripeSubscriptionId: null })).toBe(
      'free',
    );
  });

  it('returns free for invalid/unknown plan type', () => {
    expect(
      getEffectivePlan({
        plan: 'enterprise',
        planPeriodEnd: null,
        stripeSubscriptionId: null,
      }),
    ).toBe('free');
  });

  it('returns free for empty string plan', () => {
    expect(getEffectivePlan({ plan: '', planPeriodEnd: null, stripeSubscriptionId: null })).toBe(
      'free',
    );
  });
});

// ── getTrialDaysRemaining ────────────────────────────────────
describe('getTrialDaysRemaining', () => {
  it('returns correct days for 10 days out', () => {
    expect(getTrialDaysRemaining(daysFromNow(10))).toBe(10);
  });

  it('returns 14 for a fresh trial (14 days out)', () => {
    expect(getTrialDaysRemaining(daysFromNow(14))).toBe(14);
  });

  it('returns 1 for a date 12 hours away (ceiling)', () => {
    expect(getTrialDaysRemaining(hoursFromNow(12))).toBe(1);
  });

  it('returns 1 for a date 1 hour away', () => {
    expect(getTrialDaysRemaining(hoursFromNow(1))).toBe(1);
  });

  it('returns 2 for a date 25 hours away (ceiling)', () => {
    expect(getTrialDaysRemaining(hoursFromNow(25))).toBe(2);
  });

  it('returns 0 when planPeriodEnd is in the past', () => {
    expect(getTrialDaysRemaining(daysFromNow(-5))).toBe(0);
  });

  it('returns 0 when planPeriodEnd was 1 minute ago', () => {
    expect(getTrialDaysRemaining(minutesFromNow(-1))).toBe(0);
  });

  it('returns null when planPeriodEnd is null', () => {
    expect(getTrialDaysRemaining(null)).toBeNull();
  });

  it('returns a large number for far future date', () => {
    expect(getTrialDaysRemaining(daysFromNow(365))).toBe(365);
  });
});

// ── revertExpiredTrials ──────────────────────────────────────
describe('revertExpiredTrials', () => {
  it('returns 0 when no expired trials exist', async () => {
    resetMocks([]);
    const count = await revertExpiredTrials();
    expect(count).toBe(0);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(freezeExcessItems).not.toHaveBeenCalled();
    expect(broadcastToUser).not.toHaveBeenCalled();
  });

  it('reverts a single expired trial user', async () => {
    resetMocks([{ id: 'user-1', email: 'u1@test.com', trialWarningStage: 3 }]);
    const count = await revertExpiredTrials();

    expect(count).toBe(1);
    expect(freezeExcessItems).toHaveBeenCalledWith('user-1', 'free');
    expect(broadcastToUser).toHaveBeenCalledWith('user-1', 'plan_updated', 'Trial expired', {
      plan: 'free',
      paymentStatus: null,
    });
  });

  it('reverts multiple expired trial users', async () => {
    resetMocks([
      { id: 'user-1', email: 'u1@test.com', trialWarningStage: 3 },
      { id: 'user-2', email: 'u2@test.com', trialWarningStage: 3 },
      { id: 'user-3', email: 'u3@test.com', trialWarningStage: 3 },
    ]);
    const count = await revertExpiredTrials();

    expect(count).toBe(3);
    expect(freezeExcessItems).toHaveBeenCalledTimes(3);
    expect(broadcastToUser).toHaveBeenCalledTimes(3);

    for (const userId of ['user-1', 'user-2', 'user-3']) {
      expect(freezeExcessItems).toHaveBeenCalledWith(userId, 'free');
      expect(broadcastToUser).toHaveBeenCalledWith(userId, 'plan_updated', 'Trial expired', {
        plan: 'free',
        paymentStatus: null,
      });
    }
  });

  it('continues processing other users if freezeExcessItems throws for one', async () => {
    resetMocks([
      { id: 'user-1', email: 'u1@test.com', trialWarningStage: 3 },
      { id: 'user-2', email: 'u2@test.com', trialWarningStage: 3 },
    ]);
    freezeExcessItems.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce(undefined);

    const count = await revertExpiredTrials();

    expect(count).toBe(2);
    expect(freezeExcessItems).toHaveBeenCalledTimes(2);
    // Only user-2 gets broadcast (user-1 errored before broadcast)
    expect(broadcastToUser).toHaveBeenCalledTimes(1);
    expect(broadcastToUser).toHaveBeenCalledWith('user-2', 'plan_updated', 'Trial expired', {
      plan: 'free',
      paymentStatus: null,
    });
  });

  it('sends trial-ended email and advances stage to 3 when trialWarningStage < 3', async () => {
    resetMocks([{ id: 'user-1', email: 'u1@test.com', trialWarningStage: 2 }]);
    const count = await revertExpiredTrials();

    expect(count).toBe(1);
    // freeze + broadcast still happen
    expect(freezeExcessItems).toHaveBeenCalledWith('user-1', 'free');
    expect(broadcastToUser).toHaveBeenCalledWith('user-1', 'plan_updated', 'Trial expired', {
      plan: 'free',
      paymentStatus: null,
    });
    // email called exactly once with (email, 0)
    expect(sendTrialEndedEmail).toHaveBeenCalledOnce();
    expect(sendTrialEndedEmail).toHaveBeenCalledWith('u1@test.com', 0);
    // conditional stage-3 update issued
    expect(stageUpdateCalls).toHaveLength(1);
    expect(stageUpdateCalls[0].set).toEqual({ trialWarningStage: 3 });
    // WHERE encodes prior stage: and(eq(users.id, 'user-1'), eq(users.trialWarningStage, 2))
    const where = stageUpdateCalls[0].where as { __and: Array<{ __eq: unknown }> };
    expect(where.__and).toHaveLength(2);
    expect(where.__and[0].__eq).toBe('user-1');
    expect(where.__and[1].__eq).toBe(2); // prior stage
  });

  it('does NOT send trial-ended email when trialWarningStage is already 3 (idempotent)', async () => {
    resetMocks([{ id: 'user-1', email: 'u1@test.com', trialWarningStage: 3 }]);
    const count = await revertExpiredTrials();

    expect(count).toBe(1);
    // freeze + broadcast still happen
    expect(freezeExcessItems).toHaveBeenCalledWith('user-1', 'free');
    expect(broadcastToUser).toHaveBeenCalledWith('user-1', 'plan_updated', 'Trial expired', {
      plan: 'free',
      paymentStatus: null,
    });
    // email NOT sent, stage NOT updated again
    expect(sendTrialEndedEmail).not.toHaveBeenCalled();
    expect(stageUpdateCalls).toHaveLength(0);
  });

  it('when sendTrialEndedEmail throws: reversion/freeze/broadcast still happened, stage NOT advanced, no rethrow, returns count', async () => {
    resetMocks([
      { id: 'user-1', email: 'u1@test.com', trialWarningStage: 1 },
      { id: 'user-2', email: 'u2@test.com', trialWarningStage: 1 },
    ]);
    // user-1 email throws; user-2 email succeeds
    sendTrialEndedEmail
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce(undefined);

    const count = await revertExpiredTrials();

    // Does not throw; returns full count
    expect(count).toBe(2);
    // Both were frozen and broadcast
    expect(freezeExcessItems).toHaveBeenCalledTimes(2);
    expect(broadcastToUser).toHaveBeenCalledTimes(2);
    // Email attempted for both
    expect(sendTrialEndedEmail).toHaveBeenCalledTimes(2);
    // Only user-2 gets the stage advance (user-1 email errored → stage NOT advanced)
    expect(stageUpdateCalls).toHaveLength(1);
    const where = stageUpdateCalls[0].where as { __and: Array<{ __eq: unknown }> };
    expect(where.__and[0].__eq).toBe('user-2');
  });
});
