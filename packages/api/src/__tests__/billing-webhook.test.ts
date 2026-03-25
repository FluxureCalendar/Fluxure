import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Hoisted mocks ────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

  let whereResults: unknown[][] = [[]];
  let whereCallIndex = 0;
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).limit = mockLimit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).orderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    return result;
  }

  function makeLimitResult(data: unknown[]) {
    const result = { offset: mockOffset };
    mockOffset.mockResolvedValue(data);
    return result;
  }

  mockWhere.mockImplementation(() => {
    const idx = whereCallIndex++;
    const data = idx < whereResults.length ? whereResults[idx] : [];
    mockLimit.mockReturnValue(makeLimitResult(data));
    return makeWhereResult(data);
  });

  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    _mockWhere: mockWhere,
    _mockFrom: mockFrom,
    _mockValues: mockValues,
    _mockReturning: mockReturning,
    _mockSet: mockSet,
    _mockWhereReturning: mockWhereReturning,
    _mockDeleteWhere: mockDeleteWhere,
    _mockOnConflictDoNothing: mockOnConflictDoNothing,
    _mockLimit: mockLimit,
    _mockOffset: mockOffset,
    _setWhereResults: (results: unknown[][]) => {
      whereResults = results;
      whereCallIndex = 0;
    },
  };

  return { mockDb };
});

const { mockStripe } = vi.hoisted(() => {
  const mockStripe = {
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
  };
  return { mockStripe };
});

const { mockFreezeExcessItems, mockUnfreezeAllItems } = vi.hoisted(() => ({
  mockFreezeExcessItems: vi.fn().mockResolvedValue(undefined),
  mockUnfreezeAllItems: vi.fn().mockResolvedValue(undefined),
}));

const { mockBroadcastToUser } = vi.hoisted(() => ({
  mockBroadcastToUser: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../ws.js', () => ({
  broadcastToUser: mockBroadcastToUser,
  broadcast: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('../config.js', () => ({
  getStripeSecretKey: () => 'sk_test_xxx',
  getStripeWebhookSecret: () => 'whsec_test_xxx',
  isSelfHosted: () => false,
}));
vi.mock('stripe', () => {
  function StripeMock() {
    return mockStripe;
  }
  return { default: StripeMock };
});
vi.mock('../billing/freeze.js', () => ({
  freezeExcessItems: mockFreezeExcessItems,
  unfreezeAllItems: mockUnfreezeAllItems,
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

// ── Helpers ──────────────────────────────────────────────────

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ onConflictDoNothing: mockDb._mockOnConflictDoNothing });
  mockDb._mockOnConflictDoNothing.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

/** Build a fake Stripe subscription object. */
function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    status: 'active',
    customer: 'cus_123',
    items: {
      data: [
        {
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          plan: { interval: 'month' },
        },
      ],
    },
    ...overrides,
  };
}

/** Build a fake Stripe event. */
function makeEvent(type: string, dataObject: Record<string, unknown>, id = 'evt_test_001') {
  return { id, type, data: { object: dataObject } };
}

/**
 * Custom app that does NOT add express.json() before the router,
 * matching production where billing-webhook is mounted before JSON parsing.
 */
function createWebhookApp(router: express.Router): express.Express {
  const app = express();
  // No express.json() — the route itself uses raw({ type: 'application/json' })
  app.use('/api/billing-webhook', router);
  return app;
}

/** Send a webhook POST with raw JSON body and the stripe-signature header. */
function postWebhook(app: express.Express, body?: object, sig = 'test_sig') {
  const req = request(app).post('/api/billing-webhook/').set('Content-Type', 'application/json');
  if (sig) req.set('stripe-signature', sig);
  if (body) req.send(JSON.stringify(body));
  return req;
}

// ── Tests ────────────────────────────────────────────────────

describe('Billing webhook (POST /api/webhooks/stripe)', () => {
  let app: ReturnType<typeof createWebhookApp>;

  beforeAll(async () => {
    const { default: webhookRouter } = await import('../routes/billing-webhook.js');
    app = createWebhookApp(webhookRouter);
  });

  beforeEach(resetMocks);

  // ── Signature verification ──────────────────────────────────

  describe('signature verification', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('No signature');
      });

      const res = await request(app)
        .post('/api/billing-webhook/')
        .set('Content-Type', 'application/json')
        .send('{}');

      expect(res.status).toBe(400);
      expect(res.text).toBe('Invalid signature');
    });

    it('returns 400 when signature verification fails', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Webhook signature verification failed');
      });

      const res = await postWebhook(app, {}, 'bad_sig');

      expect(res.status).toBe(400);
      expect(res.text).toBe('Invalid signature');
    });
  });

  // ── checkout.session.completed ──────────────────────────────

  describe('checkout.session.completed', () => {
    it('upgrades user to pro and calls unfreezeAllItems', async () => {
      const sub = makeSubscription();
      const event = makeEvent('checkout.session.completed', {
        metadata: { userId: 'user_1' },
        subscription: 'sub_123',
      });

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockStripe.subscriptions.retrieve.mockResolvedValue(sub);
      // Idempotency insert succeeds (new event)
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      // Should update user to pro
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'pro',
          paymentStatus: 'paid',
          stripeSubscriptionId: 'sub_123',
        }),
      );

      // Should unfreeze items
      expect(mockUnfreezeAllItems).toHaveBeenCalledWith('user_1');

      // Should broadcast plan update
      expect(mockBroadcastToUser).toHaveBeenCalledWith(
        'user_1',
        'plan_updated',
        'Checkout completed',
        expect.objectContaining({ plan: 'pro', paymentStatus: 'paid' }),
      );
    });
  });

  // ── customer.subscription.updated ───────────────────────────

  describe('customer.subscription.updated', () => {
    it('updates plan and payment status for active subscription', async () => {
      const sub = makeSubscription({ status: 'active', customer: 'cus_456' });
      const event = makeEvent('customer.subscription.updated', sub);

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      // Idempotency insert succeeds
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);
      // User lookup by stripeCustomerId
      mockDb._setWhereResults([[{ id: 'user_2' }]]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(mockDb._mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'pro',
          paymentStatus: 'paid',
        }),
      );
      expect(mockFreezeExcessItems).not.toHaveBeenCalled();
    });

    it('downgrades to free and freezes excess when subscription is canceled', async () => {
      const sub = makeSubscription({ status: 'canceled', customer: 'cus_456' });
      const event = makeEvent('customer.subscription.updated', sub);

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);
      mockDb._setWhereResults([[{ id: 'user_2' }]]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(mockDb._mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
          paymentStatus: 'canceled',
        }),
      );
      expect(mockFreezeExcessItems).toHaveBeenCalledWith('user_2', 'free');
    });

    it('keeps pro for past_due status (grace period)', async () => {
      const sub = makeSubscription({ status: 'past_due', customer: 'cus_456' });
      const event = makeEvent('customer.subscription.updated', sub);

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);
      mockDb._setWhereResults([[{ id: 'user_2' }]]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(mockDb._mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'pro',
          paymentStatus: 'past_due',
        }),
      );
      expect(mockFreezeExcessItems).not.toHaveBeenCalled();
    });
  });

  // ── customer.subscription.deleted ───────────────────────────

  describe('customer.subscription.deleted', () => {
    it('downgrades to free, clears subscription, and freezes excess', async () => {
      const sub = makeSubscription({ status: 'canceled', customer: 'cus_789' });
      const event = makeEvent('customer.subscription.deleted', sub);

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);
      mockDb._setWhereResults([[{ id: 'user_3' }]]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(mockDb._mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
          stripeSubscriptionId: null,
          planPeriodEnd: null,
          billingInterval: null,
        }),
      );
      expect(mockFreezeExcessItems).toHaveBeenCalledWith('user_3', 'free');
      expect(mockBroadcastToUser).toHaveBeenCalledWith(
        'user_3',
        'plan_updated',
        'Subscription canceled',
        expect.objectContaining({ plan: 'free', paymentStatus: null }),
      );
    });
  });

  // ── invoice.paid ────────────────────────────────────────────

  describe('invoice.paid', () => {
    it('extends period end for the user', async () => {
      const sub = makeSubscription();
      const event = makeEvent('invoice.paid', {
        customer: 'cus_paid',
        parent: {
          subscription_details: { subscription: 'sub_123' },
        },
      });

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockStripe.subscriptions.retrieve.mockResolvedValue(sub);
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);
      mockDb._setWhereResults([[{ id: 'user_4' }]]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(mockDb._mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentStatus: 'paid',
          planPeriodEnd: expect.any(String),
        }),
      );
    });
  });

  // ── invoice.payment_failed ──────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('sets paymentStatus to failed', async () => {
      const event = makeEvent('invoice.payment_failed', {
        id: 'inv_fail',
        customer: 'cus_fail',
      });

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);
      mockDb._setWhereResults([[{ id: 'user_5' }]]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(mockDb._mockSet).toHaveBeenCalledWith({ paymentStatus: 'failed' });
      expect(mockBroadcastToUser).toHaveBeenCalledWith(
        'user_5',
        'plan_updated',
        'Payment failed',
        expect.objectContaining({ paymentStatus: 'failed' }),
      );
    });
  });

  // ── Idempotency ─────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns 200 without processing when event already exists', async () => {
      const event = makeEvent(
        'checkout.session.completed',
        {
          metadata: { userId: 'user_1' },
          subscription: 'sub_123',
        },
        'evt_duplicate',
      );

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      // Idempotency insert returns empty (conflict — already processed)
      mockDb._mockReturning.mockResolvedValue([]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      // Should NOT have called update or freeze/unfreeze
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockUnfreezeAllItems).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });
  });

  // ── Unknown event type ──────────────────────────────────────

  describe('unknown event type', () => {
    it('returns 200 for unrecognized event types', async () => {
      const event = makeEvent('unknown.event.type', { foo: 'bar' });

      mockStripe.webhooks.constructEvent.mockReturnValue(event);
      mockDb._mockReturning.mockResolvedValue([{ id: event.id }]);

      const res = await postWebhook(app, {});

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);

      // Should not have attempted any user updates
      expect(mockDb._mockSet).not.toHaveBeenCalled();
    });
  });
});
