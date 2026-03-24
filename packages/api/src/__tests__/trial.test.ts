import { describe, it, expect, vi, beforeEach } from 'vitest';
import { daysFromNow, hoursFromNow } from './helpers.js';

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ── Mock setup for revertExpiredTrials ───────────────────────
const mockReturning = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSet = vi.fn();

vi.mock('../db/pg-index.js', () => ({
  db: {
    update: vi.fn().mockImplementation(() => ({ set: mockSet })),
  },
}));

vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
}));

vi.mock('../billing/freeze.js', () => ({
  freezeExcessItems: vi.fn().mockResolvedValue(undefined),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockReturning.mockResolvedValue([]);
  mockUpdateWhere.mockReturnValue({ returning: mockReturning });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({ set: mockSet }));
});

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
    mockReturning.mockResolvedValue([]);
    const count = await revertExpiredTrials();
    expect(count).toBe(0);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(freezeExcessItems).not.toHaveBeenCalled();
    expect(broadcastToUser).not.toHaveBeenCalled();
  });

  it('reverts a single expired trial user', async () => {
    mockReturning.mockResolvedValue([{ id: 'user-1' }]);
    const count = await revertExpiredTrials();

    expect(count).toBe(1);
    expect(freezeExcessItems).toHaveBeenCalledWith('user-1', 'free');
    expect(broadcastToUser).toHaveBeenCalledWith('user-1', 'plan_updated', 'Trial expired', {
      plan: 'free',
      paymentStatus: null,
    });
  });

  it('reverts multiple expired trial users', async () => {
    mockReturning.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]);
    const count = await revertExpiredTrials();

    expect(count).toBe(3);
    expect(freezeExcessItems).toHaveBeenCalledTimes(3);
    expect(broadcastToUser).toHaveBeenCalledTimes(3);

    // Each user gets their own freeze + broadcast
    for (const userId of ['user-1', 'user-2', 'user-3']) {
      expect(freezeExcessItems).toHaveBeenCalledWith(userId, 'free');
      expect(broadcastToUser).toHaveBeenCalledWith(userId, 'plan_updated', 'Trial expired', {
        plan: 'free',
        paymentStatus: null,
      });
    }
  });

  it('continues processing other users if freezeExcessItems throws for one', async () => {
    mockReturning.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
    freezeExcessItems.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce(undefined);

    const count = await revertExpiredTrials();

    // Still returns total count (the update already happened)
    expect(count).toBe(2);
    // Both users attempted
    expect(freezeExcessItems).toHaveBeenCalledTimes(2);
    // Only user-2 gets broadcast (user-1 errored before broadcast)
    expect(broadcastToUser).toHaveBeenCalledTimes(1);
    expect(broadcastToUser).toHaveBeenCalledWith('user-2', 'plan_updated', 'Trial expired', {
      plan: 'free',
      paymentStatus: null,
    });
  });
});
