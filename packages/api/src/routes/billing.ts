import { Router } from 'express';
import Stripe from 'stripe';
import { and, count, eq, inArray } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import {
  users,
  habits,
  tasks,
  smartMeetings,
  schedulingLinks,
  calendars,
} from '../db/pg-schema.js';
import { broadcastToUser } from '../ws.js';
import { activeSetSchema } from '../validation.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { z } from 'zod/v4';
import { sendError } from './helpers.js';
import { createLogger } from '../logger.js';
import { getPlanLimits } from '@fluxure/shared';
import { isTrialActive, getEffectivePlan, getTrialDaysRemaining } from '../billing/trial.js';
import {
  getStripeSecretKey,
  getStripeProMonthlyPriceId,
  getStripeProAnnualPriceId,
  FRONTEND_URL,
  isSelfHosted,
} from '../config.js';

const log = createLogger('billing');
const router = Router();

class ActiveSetLimitError extends Error {}

let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = getStripeSecretKey();
  if (key) _stripe = new Stripe(key);
  return _stripe;
}
function getAppUrl(): string {
  return FRONTEND_URL;
}

// GET /api/billing/status
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [user] = await db
      .select({
        plan: users.plan,
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
        planPeriodEnd: users.planPeriodEnd,
        billingInterval: users.billingInterval,
        paymentStatus: users.paymentStatus,
      })
      .from(users)
      .where(eq(users.id, req.userId));

    if (!user) {
      sendError(res, 404, 'Not found');
      return;
    }

    const effectivePlan = getEffectivePlan(user);
    const trial = isTrialActive(user);

    let cancelAtPeriodEnd = false;
    let cancelAt: string | null = null;

    if (user.stripeSubscriptionId && getStripe()) {
      try {
        const subscription = await getStripe()!.subscriptions.retrieve(user.stripeSubscriptionId);
        cancelAtPeriodEnd = subscription.cancel_at_period_end;
        cancelAt = subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000).toISOString()
          : null;
      } catch (err) {
        log.warn(
          {
            subscriptionId: user.stripeSubscriptionId,
            error: err instanceof Error ? err.message : String(err),
          },
          'Failed to retrieve Stripe subscription for cancel status',
        );
      }
    }

    const selfHosted = isSelfHosted();
    const resolvedPlan = selfHosted ? 'pro' : effectivePlan;

    res.json({
      plan: resolvedPlan,
      limits: getPlanLimits(resolvedPlan),
      billingInterval: selfHosted ? null : user.billingInterval,
      periodEnd: selfHosted ? null : user.planPeriodEnd,
      hasSubscription: selfHosted ? false : !!user.stripeSubscriptionId,
      isTrial: selfHosted ? false : trial,
      trialDaysRemaining: selfHosted
        ? null
        : trial
          ? getTrialDaysRemaining(user.planPeriodEnd)
          : null,
      paymentStatus: selfHosted ? null : user.paymentStatus,
      cancelAtPeriodEnd: selfHosted ? false : cancelAtPeriodEnd,
      cancelAt: selfHosted ? null : cancelAt,
      selfHosted,
    });
  }),
);

// POST /api/billing/checkout
router.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    if (!getStripe()) {
      sendError(res, 503, 'Billing is not configured');
      return;
    }

    const checkoutBodySchema = z.object({
      interval: z.enum(['monthly', 'annual']).optional(),
    });
    const parsed = checkoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid checkout parameters');
      return;
    }
    const { interval } = parsed.data;
    const priceId =
      interval === 'annual' ? getStripeProAnnualPriceId() : getStripeProMonthlyPriceId();
    if (!priceId) {
      sendError(res, 503, 'Billing prices not configured');
      return;
    }

    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, req.userId));

    if (!user) {
      sendError(res, 404, 'Not found');
      return;
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await getStripe()!.customers.create({
        email: user.email,
        name: user.name ?? undefined,
        metadata: { userId: req.userId },
      });
      customerId = customer.id;
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, req.userId));
    }

    const session = await getStripe()!.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${getAppUrl()}/settings?billing=success`,
      cancel_url: `${getAppUrl()}/settings?billing=cancel`,
      metadata: { userId: req.userId },
    });

    if (!session.url) {
      sendError(res, 500, 'Checkout session URL unavailable');
      return;
    }

    res.json({ url: session.url });
  }),
);

// POST /api/billing/portal
router.post(
  '/portal',
  asyncHandler(async (req, res) => {
    if (!getStripe()) {
      sendError(res, 503, 'Billing is not configured');
      return;
    }

    const [user] = await db
      .select({
        stripeCustomerId: users.stripeCustomerId,
        stripeSubscriptionId: users.stripeSubscriptionId,
      })
      .from(users)
      .where(eq(users.id, req.userId));

    if (!user?.stripeCustomerId) {
      sendError(res, 400, 'No billing account found');
      return;
    }

    if (!user.stripeSubscriptionId) {
      sendError(res, 400, 'No active subscription. Please subscribe first.');
      return;
    }

    const session = await getStripe()!.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getAppUrl()}/settings`,
    });

    res.json({ url: session.url });
  }),
);

const ACTIVE_SET_TABLES = {
  habit: { table: habits, limitKey: 'maxHabits' },
  task: { table: tasks, limitKey: 'maxTasks' },
  meeting: { table: smartMeetings, limitKey: 'maxMeetings' },
  link: { table: schedulingLinks, limitKey: 'maxSchedulingLinks' },
  calendar: { table: calendars, limitKey: 'maxCalendars' },
} as const;

// POST /api/billing/active-set
router.post(
  '/active-set',
  asyncHandler(async (req, res) => {
    if (isSelfHosted()) {
      sendError(res, 400, 'All items are active on your plan');
      return;
    }

    const parsed = activeSetSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid active-set request');
      return;
    }
    const { type, activate, freeze } = parsed.data;

    const [user] = await db
      .select({
        plan: users.plan,
        planPeriodEnd: users.planPeriodEnd,
        stripeSubscriptionId: users.stripeSubscriptionId,
      })
      .from(users)
      .where(eq(users.id, req.userId));
    if (!user) {
      sendError(res, 404, 'Not found');
      return;
    }

    const effectivePlan = getEffectivePlan(user);
    const limit = getPlanLimits(effectivePlan)[ACTIVE_SET_TABLES[type].limitKey];
    if (limit === -1) {
      sendError(res, 400, 'All items are active on your plan');
      return;
    }

    const { table } = ACTIVE_SET_TABLES[type];

    try {
      await db.transaction(async (tx) => {
        if (activate.length > 0) {
          await tx
            .update(table)
            .set({ frozen: false })
            .where(and(eq(table.userId, req.userId), inArray(table.id, activate)));
        }
        if (freeze.length > 0) {
          await tx
            .update(table)
            .set({ frozen: true })
            .where(and(eq(table.userId, req.userId), inArray(table.id, freeze)));
        }

        const [{ value: activeCount }] = await tx
          .select({ value: count() })
          .from(table)
          .where(and(eq(table.userId, req.userId), eq(table.frozen, false)));

        if (activeCount > limit) {
          throw new ActiveSetLimitError();
        }
      });
    } catch (err) {
      if (err instanceof ActiveSetLimitError) {
        sendError(res, 409, `That would exceed your plan limit of ${limit}`);
        return;
      }
      throw err;
    }

    broadcastToUser(req.userId, 'plan_updated', 'Active items updated', {});
    res.json({ ok: true });
  }),
);

export default router;
