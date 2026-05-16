import { describe, it, expect, vi, beforeEach } from 'vitest';
import { daysFromNow } from './helpers.js';

// ── Mock tracking ────────────────────────────────────────────
/**
 * selectRows: the candidates returned by the initial db.select().from().where() query.
 * updateCalls: each call to db.update().set(payload).where(pred) pushes here.
 * selectWherePreds: each .where(pred) arg passed to the select chain pushes here.
 */
let selectRows: unknown[] = [];
const updateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];
const selectWherePreds: unknown[] = [];

// ── Module mocks ─────────────────────────────────────────────

/**
 * Mock drizzle-orm: and/eq/isNull/isNotNull return inspectable sentinels so
 * we can assert that the conditional update WHERE includes the prior stage.
 */
vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (_col: unknown, val: unknown) => ({ __eq: val }),
    and: (...args: unknown[]) => ({ __and: args }),
    isNull: (_col: unknown) => ({ __isNull: true }),
    isNotNull: (_col: unknown) => ({ __isNotNull: true }),
  };
});

/**
 * Mock db: supports the two access patterns in trial-warnings.ts:
 *   1. db.select({ ... }).from(users).where(...)  → Promise<candidates[]>
 *   2. db.update(users).set({ trialWarningStage }).where(and(eq(id), eq(stage)))
 */
vi.mock('../db/pg-index.js', () => {
  function makeSelectChain() {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((pred: unknown) => {
        selectWherePreds.push(pred);
        return Promise.resolve(selectRows);
      }),
    };
  }

  function makeUpdateChain() {
    return {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation((pred: unknown) => {
          updateCalls.push({ set: payload, where: pred });
          return Promise.resolve(undefined);
        }),
      })),
    };
  }

  return {
    db: {
      select: vi.fn().mockImplementation(() => makeSelectChain()),
      update: vi.fn().mockImplementation(() => makeUpdateChain()),
    },
  };
});

vi.mock('../auth/email.js', () => ({
  sendTrialEndingEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Lazy imports (after mocks are registered) ────────────────
const { sendTrialWarnings } = await import('../billing/trial-warnings.js');
const { db } = await import('../db/pg-index.js');
const { sendTrialEndingEmail } = (await import('../auth/email.js')) as unknown as {
  sendTrialEndingEmail: ReturnType<typeof vi.fn>;
};

// ── Reset helpers ────────────────────────────────────────────

function resetState(rows: unknown[] = []) {
  selectRows = rows;
  updateCalls.length = 0;
  selectWherePreds.length = 0;
  vi.clearAllMocks();

  // Re-apply mock implementations after clearAllMocks wipes call counts + implementations.
  function makeSelectChain() {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation((pred: unknown) => {
        selectWherePreds.push(pred);
        return Promise.resolve(selectRows);
      }),
    };
  }
  function makeUpdateChain() {
    return {
      set: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation((pred: unknown) => {
          updateCalls.push({ set: payload, where: pred });
          return Promise.resolve(undefined);
        }),
      })),
    };
  }
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain());
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => makeUpdateChain());
  sendTrialEndingEmail.mockResolvedValue(undefined);
}

/** Extract the pair of __eq values from the conditional update WHERE:
 *  and(eq(users.id, id), eq(users.trialWarningStage, priorStage))
 *  → { __and: [{ __eq: id }, { __eq: priorStage }] }
 */
function extractUpdateWherePair(where: unknown): [unknown, unknown] | null {
  if (!where || typeof where !== 'object') return null;
  const pred = where as Record<string, unknown>;
  if ('__and' in pred && Array.isArray(pred.__and) && pred.__and.length === 2) {
    const a = pred.__and[0] as Record<string, unknown>;
    const b = pred.__and[1] as Record<string, unknown>;
    if ('__eq' in a && '__eq' in b) return [a.__eq, b.__eq];
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────

describe('sendTrialWarnings', () => {
  beforeEach(() => resetState());

  it('does NOT email a user with 4 days left (stage 0) — only warn at ≤3', async () => {
    resetState([
      { id: 'u1', email: 'a@test.com', planPeriodEnd: daysFromNow(4), trialWarningStage: 0 },
    ]);
    const sent = await sendTrialWarnings();

    expect(sent).toBe(0);
    expect(sendTrialEndingEmail).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('emails a user with 3 days left (stage 0) with daysLabel=3 and advances stage 0→1', async () => {
    resetState([
      { id: 'u2', email: 'b@test.com', planPeriodEnd: daysFromNow(3), trialWarningStage: 0 },
    ]);
    const sent = await sendTrialWarnings();

    expect(sent).toBe(1);
    expect(sendTrialEndingEmail).toHaveBeenCalledOnce();
    expect(sendTrialEndingEmail).toHaveBeenCalledWith('b@test.com', 3);

    // Stage advanced: set { trialWarningStage: 1 }
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual({ trialWarningStage: 1 });

    // WHERE must be conditional: and(eq(id, 'u2'), eq(trialWarningStage, 0))
    const pair = extractUpdateWherePair(updateCalls[0].where);
    expect(pair).not.toBeNull();
    expect(pair![0]).toBe('u2'); // eq(users.id, 'u2')
    expect(pair![1]).toBe(0); // eq(users.trialWarningStage, 0)  ← prior stage
  });

  it('does NOT email a user with 3 days left who already received the day-3 email (stage 1)', async () => {
    resetState([
      { id: 'u3', email: 'c@test.com', planPeriodEnd: daysFromNow(3), trialWarningStage: 1 },
    ]);
    const sent = await sendTrialWarnings();

    expect(sent).toBe(0);
    expect(sendTrialEndingEmail).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('emails a user with 1 day left (stage 1) with daysLabel=1 and advances stage 1→2', async () => {
    resetState([
      { id: 'u4', email: 'd@test.com', planPeriodEnd: daysFromNow(1), trialWarningStage: 1 },
    ]);
    const sent = await sendTrialWarnings();

    expect(sent).toBe(1);
    expect(sendTrialEndingEmail).toHaveBeenCalledOnce();
    expect(sendTrialEndingEmail).toHaveBeenCalledWith('d@test.com', 1);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual({ trialWarningStage: 2 });

    // WHERE must be conditional: and(eq(id, 'u4'), eq(trialWarningStage, 1))
    const pair = extractUpdateWherePair(updateCalls[0].where);
    expect(pair).not.toBeNull();
    expect(pair![0]).toBe('u4');
    expect(pair![1]).toBe(1); // ← prior stage 1
  });

  it('does NOT email a user with 1 day left who already received the day-1 email (stage 2)', async () => {
    resetState([
      { id: 'u5', email: 'e@test.com', planPeriodEnd: daysFromNow(1), trialWarningStage: 2 },
    ]);
    const sent = await sendTrialWarnings();

    expect(sent).toBe(0);
    expect(sendTrialEndingEmail).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('a paid subscriber (stripeSubscriptionId set) is never in the candidate set — and candidate WHERE contains all three required filters', async () => {
    resetState([]); // empty result simulates "no rows matched the WHERE"
    const sent = await sendTrialWarnings();

    // Behavioural: no email sent, no stage update
    expect(sent).toBe(0);
    expect(sendTrialEndingEmail).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);

    // The select must have been called (candidate query was executed)
    expect(db.select).toHaveBeenCalledOnce();

    // Structural: assert the candidate SELECT's .where() predicate is an __and of exactly
    // three conditions: eq(plan,'pro'), isNull(stripeSubscriptionId), isNotNull(planPeriodEnd).
    // This ensures that removing any one of the three filters would cause this test to fail.
    expect(selectWherePreds).toHaveLength(1);
    const wherePred = selectWherePreds[0] as { __and: unknown[] };
    expect(wherePred.__and).toHaveLength(3);
    // eq(users.plan, 'pro')
    expect(wherePred.__and).toContainEqual({ __eq: 'pro' });
    // isNull(users.stripeSubscriptionId)
    expect(
      wherePred.__and.some((c) => c !== null && typeof c === 'object' && '__isNull' in c),
    ).toBe(true);
    // isNotNull(users.planPeriodEnd)
    expect(
      wherePred.__and.some((c) => c !== null && typeof c === 'object' && '__isNotNull' in c),
    ).toBe(true);
  });

  it('if sendTrialEndingEmail throws, stage is NOT advanced and function continues to next user', async () => {
    resetState([
      { id: 'u6', email: 'f@test.com', planPeriodEnd: daysFromNow(3), trialWarningStage: 0 },
      { id: 'u7', email: 'g@test.com', planPeriodEnd: daysFromNow(3), trialWarningStage: 0 },
    ]);

    // First user's email throws; second succeeds
    sendTrialEndingEmail
      .mockRejectedValueOnce(new Error('SMTP failure'))
      .mockResolvedValueOnce(undefined);

    const sent = await sendTrialWarnings();

    // Only u7 was fully processed (email sent + stage advanced)
    expect(sent).toBe(1);
    expect(sendTrialEndingEmail).toHaveBeenCalledTimes(2);

    // Only one update call — u6 errored before update, u7 succeeded
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set).toEqual({ trialWarningStage: 1 });

    // The update is for u7 (not u6)
    const pair = extractUpdateWherePair(updateCalls[0].where);
    expect(pair).not.toBeNull();
    expect(pair![0]).toBe('u7');
  });
});
