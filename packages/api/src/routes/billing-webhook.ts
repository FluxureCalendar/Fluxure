import { Router, raw } from 'express';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users, stripeWebhookEvents } from '../db/pg-schema.js';
import { createLogger } from '../logger.js';
import { getStripeSecretKey, getStripeWebhookSecret } from '../config.js';
import { freezeExcessItems, unfreezeAllItems } from '../billing/freeze.js';
import { broadcastToUser } from '../ws.js';
import { asyncHandler } from '../middleware/async-handler.js';

const log = createLogger('billing-webhook');
const router = Router();

let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = getStripeSecretKey();
  if (key) _stripe = new Stripe(key);
  return _stripe;
}

/** Extract current_period_end from a subscription's first item (Stripe v20 API). */
function getPeriodEnd(sub: Stripe.Subscription): string {
  const periodEnd = sub.items.data[0]?.current_period_end;
  return new Date((periodEnd ?? 0) * 1000).toISOString();
}

/** Extract billing interval from a subscription's first item. */
function getBillingInterval(sub: Stripe.Subscription): 'annual' | 'monthly' {
  return sub.items.data[0]?.plan?.interval === 'year' ? 'annual' : 'monthly';
}

/** Safely extract customer ID string from a Stripe customer field (string | object). */
function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === 'string' ? customer : customer.id;
}

router.post(
  '/',
  raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const stripe = getStripe();
    const webhookSecret = getStripeWebhookSecret();
    if (!stripe || !webhookSecret || webhookSecret.length === 0) {
      res.status(503).send('Billing not configured');
      return;
    }

    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      log.error({ err }, 'Webhook signature verification failed');
      res.status(400).send('Invalid signature');
      return;
    }

    try {
      // Atomic idempotency guard: INSERT ... ON CONFLICT DO NOTHING
      // If two webhook deliveries race, only one will succeed the insert.
      const [inserted] = await db
        .insert(stripeWebhookEvents)
        .values({ id: event.id, eventType: event.type })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        // Already processed by a prior delivery
        res.json({ received: true });
        return;
      }

      // Process the event (only reaches here if we won the insert race)
      await handleEvent(event, stripe);
    } catch (err) {
      log.error({ err, eventId: event.id }, 'Webhook handler error');
      res.status(500).send('Handler error');
      return;
    }

    res.json({ received: true });
  }),
);

async function handleEvent(event: Stripe.Event, stripe: Stripe): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId || !session.subscription) break;
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      await db
        .update(users)
        .set({
          plan: 'pro',
          paymentStatus: 'paid',
          stripeSubscriptionId: subscription.id,
          planPeriodEnd: getPeriodEnd(subscription),
          billingInterval: getBillingInterval(subscription),
        })
        .where(eq(users.id, userId));
      await unfreezeAllItems(userId);
      broadcastToUser(userId, 'plan_updated', 'Checkout completed', {
        plan: 'pro',
        paymentStatus: 'paid',
      });
      log.info({ userId }, 'User upgraded to Pro');
      break;
    }
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = getCustomerId(subscription.customer);
      // Security: User lookup by stripeCustomerId is safe here because
      // Stripe webhook signature verification (above) guarantees event authenticity.
      // No additional tenant isolation is needed for webhook-initiated lookups.
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.stripeCustomerId, customerId));
      if (!user) break;
      // Grace period: keep pro for active and past_due (payment retry in progress)
      const keepPro = subscription.status === 'active' || subscription.status === 'past_due';
      const newPlan = keepPro ? 'pro' : 'free';
      await db
        .update(users)
        .set({
          plan: newPlan,
          paymentStatus: subscription.status === 'active' ? 'paid' : subscription.status,
          planPeriodEnd: getPeriodEnd(subscription),
          billingInterval: getBillingInterval(subscription),
        })
        .where(eq(users.id, user.id));
      broadcastToUser(user.id, 'plan_updated', 'Subscription updated', {
        plan: newPlan,
        paymentStatus: subscription.status === 'active' ? 'paid' : subscription.status,
      });
      if (!keepPro) {
        await freezeExcessItems(user.id, 'free');
        log.info(
          { userId: user.id, status: subscription.status },
          'Subscription lapsed, downgraded to free',
        );
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = getCustomerId(subscription.customer);
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.stripeCustomerId, customerId));
      if (!user) break;
      await db
        .update(users)
        .set({
          plan: 'free',
          stripeSubscriptionId: null,
          planPeriodEnd: null,
          billingInterval: null,
        })
        .where(eq(users.id, user.id));
      await freezeExcessItems(user.id, 'free');
      broadcastToUser(user.id, 'plan_updated', 'Subscription canceled', {
        plan: 'free',
        paymentStatus: null,
      });
      log.info({ userId: user.id }, 'Subscription canceled, downgraded to free');
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.customer) break;
      const customerId = getCustomerId(invoice.customer);
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.stripeCustomerId, customerId));
      const subDetails = invoice.parent?.subscription_details;
      const subId =
        typeof subDetails?.subscription === 'string'
          ? subDetails.subscription
          : subDetails?.subscription?.id;
      if (!user || !subId) break;
      const subscription = await stripe.subscriptions.retrieve(subId);
      await db
        .update(users)
        .set({
          paymentStatus: 'paid',
          planPeriodEnd: getPeriodEnd(subscription),
        })
        .where(eq(users.id, user.id));
      log.info({ userId: user.id }, 'Invoice paid, period end extended');
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.customer) break;
      const failedCustomerId = getCustomerId(invoice.customer);
      const [failedUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.stripeCustomerId, failedCustomerId));
      if (failedUser) {
        await db.update(users).set({ paymentStatus: 'failed' }).where(eq(users.id, failedUser.id));
        broadcastToUser(failedUser.id, 'plan_updated', 'Payment failed', {
          plan: 'pro',
          paymentStatus: 'failed',
        });
      }
      log.warn(
        { customerId: failedCustomerId, userId: failedUser?.id, invoiceId: invoice.id },
        'Invoice payment failed',
      );
      break;
    }
  }
}

export default router;
