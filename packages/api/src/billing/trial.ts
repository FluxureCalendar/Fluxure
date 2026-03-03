import { and, eq, isNull, lte } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users } from '../db/pg-schema.js';
import type { PlanType } from '@fluxure/shared';
import { freezeExcessItems } from './freeze.js';
import { broadcastToUser } from '../ws.js';
import { createLogger } from '../logger.js';

const log = createLogger('trial');

const VALID_PLAN_TYPES: ReadonlySet<string> = new Set(['free', 'pro']);
function isValidPlanType(plan: string): plan is PlanType {
  return VALID_PLAN_TYPES.has(plan);
}

const TRIAL_DURATION_DAYS = 14;

export function getTrialEndDate(): string {
  return new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function isTrialActive(user: {
  plan: string;
  planPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
}): boolean {
  if (user.plan !== 'pro') return false;
  if (!user.planPeriodEnd) return false;
  if (user.stripeSubscriptionId) return false; // Paid subscriber, not trial
  return new Date(user.planPeriodEnd) > new Date();
}

export function getEffectivePlan(user: {
  plan: string;
  planPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
}): PlanType {
  if (user.plan === 'pro') {
    // Paid subscriber — always pro
    if (user.stripeSubscriptionId) return 'pro';
    // Trial — check expiry
    if (user.planPeriodEnd && new Date(user.planPeriodEnd) > new Date()) return 'pro';
    // Trial expired
    return 'free';
  }
  return isValidPlanType(user.plan) ? user.plan : 'free';
}

export function getTrialDaysRemaining(planPeriodEnd: string | null): number | null {
  if (!planPeriodEnd) return null;
  const remaining = Math.ceil(
    (new Date(planPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  return remaining > 0 ? remaining : 0;
}

/** Revert expired trial users to free plan in the DB, freeze excess items, and notify. */
export async function revertExpiredTrials(): Promise<number> {
  const rows = await db
    .update(users)
    .set({ plan: 'free' })
    .where(
      and(
        eq(users.plan, 'pro'),
        isNull(users.stripeSubscriptionId),
        lte(users.planPeriodEnd, new Date().toISOString()),
      ),
    )
    .returning({ id: users.id });

  // Freeze excess items and notify each reverted user
  for (const { id: userId } of rows) {
    try {
      await freezeExcessItems(userId, 'free');
      broadcastToUser(userId, 'plan_updated', 'Trial expired', {
        plan: 'free',
        paymentStatus: null,
      });
    } catch (err) {
      log.error({ err, userId }, 'Failed to freeze items after trial expiry');
    }
  }

  return rows.length;
}
