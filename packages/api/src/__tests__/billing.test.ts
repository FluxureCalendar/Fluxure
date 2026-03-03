import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

  let whereResults: unknown[][] = [[]];
  let whereCallIndex = 0;
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
    (result as any).limit = mockLimit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock augmentation
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock callback
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        insert: vi.fn().mockReturnValue({ values: mockValues }),
        update: vi.fn().mockReturnValue({ set: mockSet }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      };
      return fn(tx);
    }),
    _mockWhere: mockWhere,
    _mockFrom: mockFrom,
    _mockValues: mockValues,
    _mockReturning: mockReturning,
    _mockSet: mockSet,
    _mockWhereReturning: mockWhereReturning,
    _mockDeleteWhere: mockDeleteWhere,
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
    customers: {
      create: vi.fn(),
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  };
  return { mockStripe };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

let stripeSecretKey = '';
let stripeMonthlyPriceId = '';
let stripeAnnualPriceId = '';
let corsOrigin = 'http://localhost:5173';

vi.mock('../config.js', () => ({
  getStripeSecretKey: () => stripeSecretKey,
  getStripeProMonthlyPriceId: () => stripeMonthlyPriceId,
  getStripeProAnnualPriceId: () => stripeAnnualPriceId,
  get CORS_ORIGIN() {
    return corsOrigin;
  },
  get FRONTEND_URL() {
    return corsOrigin;
  },
}));

vi.mock('stripe', () => {
  function StripeMock() {
    return mockStripe;
  }
  return { default: StripeMock };
});

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import { createTestApp } from './helpers.js';

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });

  stripeSecretKey = '';
  stripeMonthlyPriceId = '';
  stripeAnnualPriceId = '';
  corsOrigin = 'http://localhost:5173';
}

describe('Billing routes (Stripe not configured)', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    const { default: billingRouter } = await import('../routes/billing.js');
    app = createTestApp('billing', billingRouter);
  });

  beforeEach(resetMocks);

  describe('GET /api/billing/status', () => {
    it('returns free plan status for a free user', async () => {
      mockDb._setWhereResults([
        [
          {
            plan: 'free',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            planPeriodEnd: null,
            billingInterval: null,
            paymentStatus: null,
          },
        ],
      ]);

      const res = await request(app).get('/api/billing/status');

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('free');
      expect(res.body.hasSubscription).toBe(false);
      expect(res.body.billingInterval).toBeNull();
      expect(res.body.periodEnd).toBeNull();
      expect(res.body.limits).toBeDefined();
      expect(res.body.limits.maxHabits).toBe(3);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.cancelAt).toBeNull();
    });

    it('returns pro plan status for a pro user', async () => {
      const periodEnd = '2026-04-15T00:00:00.000Z';
      mockDb._setWhereResults([
        [
          {
            plan: 'pro',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_123',
            planPeriodEnd: periodEnd,
            billingInterval: 'monthly',
            paymentStatus: null,
          },
        ],
      ]);

      const res = await request(app).get('/api/billing/status');

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('pro');
      expect(res.body.hasSubscription).toBe(true);
      expect(res.body.billingInterval).toBe('monthly');
      expect(res.body.periodEnd).toBe(periodEnd);
      expect(res.body.limits).toBeDefined();
      expect(res.body.limits.maxHabits).toBe(-1);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.cancelAt).toBeNull();
    });

    it('returns 404 when user not found', async () => {
      mockDb._setWhereResults([[]]);

      const res = await request(app).get('/api/billing/status');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });

  describe('POST /api/billing/checkout', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const res = await request(app).post('/api/billing/checkout').send({ interval: 'monthly' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Billing is not configured');
    });
  });

  describe('POST /api/billing/portal', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const res = await request(app).post('/api/billing/portal').send({});

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Billing is not configured');
    });
  });
});

describe('Billing routes (Stripe configured)', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    stripeSecretKey = 'sk_test_123';
    stripeMonthlyPriceId = 'price_monthly_123';
    stripeAnnualPriceId = 'price_annual_123';

    vi.resetModules();

    vi.doMock('../db/pg-index.js', () => ({ db: mockDb }));
    vi.doMock('../ws.js', () => ({
      broadcastToUser: vi.fn(),
      broadcast: vi.fn(),
    }));
    vi.doMock('../polling-ref.js', () => ({
      triggerReschedule: vi.fn(),
    }));
    vi.doMock('../logger.js', () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));
    vi.doMock('../config.js', () => ({
      getStripeSecretKey: () => 'sk_test_123',
      getStripeProMonthlyPriceId: () => 'price_monthly_123',
      getStripeProAnnualPriceId: () => 'price_annual_123',
      CORS_ORIGIN: 'http://localhost:5173',
      FRONTEND_URL: 'http://localhost:5173',
    }));
    vi.doMock('stripe', () => {
      function StripeMock() {
        return mockStripe;
      }
      return { default: StripeMock };
    });

    const { default: billingRouter } = await import('../routes/billing.js');
    app = createTestApp('billing', billingRouter);
  });

  beforeEach(resetMocks);

  describe('POST /api/billing/checkout', () => {
    it('creates checkout session and returns URL for existing customer', async () => {
      mockDb._setWhereResults([[{ stripeCustomerId: 'cus_existing', email: 'test@example.com' }]]);

      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session_123',
      });

      const res = await request(app).post('/api/billing/checkout').send({ interval: 'monthly' });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/session_123');
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_existing',
          mode: 'subscription',
        }),
      );
    });

    it('creates new Stripe customer if none exists', async () => {
      mockDb._setWhereResults([[{ stripeCustomerId: null, email: 'test@example.com' }]]);

      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session_456',
      });

      const res = await request(app).post('/api/billing/checkout').send({ interval: 'annual' });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/session_456');
      expect(mockStripe.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
        }),
      );
    });
  });

  describe('POST /api/billing/portal', () => {
    it('returns 400 when user has no stripeCustomerId', async () => {
      mockDb._setWhereResults([[{ stripeCustomerId: null }]]);

      const res = await request(app).post('/api/billing/portal').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No billing account found');
    });

    it('returns 400 when user has no stripeSubscriptionId', async () => {
      mockDb._setWhereResults([[{ stripeCustomerId: 'cus_existing', stripeSubscriptionId: null }]]);

      const res = await request(app).post('/api/billing/portal').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No active subscription. Please subscribe first.');
    });

    it('returns portal URL for user with stripeCustomerId and subscription', async () => {
      mockDb._setWhereResults([
        [{ stripeCustomerId: 'cus_existing', stripeSubscriptionId: 'sub_123' }],
      ]);

      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/portal_123',
      });

      const res = await request(app).post('/api/billing/portal').send({});

      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://billing.stripe.com/portal_123');
      expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_existing',
        }),
      );
    });
  });

  describe('GET /api/billing/status (with Stripe)', () => {
    it('returns cancelAtPeriodEnd from Stripe subscription', async () => {
      const periodEnd = '2026-04-15T00:00:00.000Z';
      const cancelAt = Math.floor(new Date('2026-04-15T00:00:00.000Z').getTime() / 1000);
      mockDb._setWhereResults([
        [
          {
            plan: 'pro',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_cancel',
            planPeriodEnd: periodEnd,
            billingInterval: 'monthly',
            paymentStatus: 'active',
          },
        ],
      ]);

      mockStripe.subscriptions.retrieve.mockResolvedValue({
        cancel_at_period_end: true,
        cancel_at: cancelAt,
      });

      const res = await request(app).get('/api/billing/status');

      expect(res.status).toBe(200);
      expect(res.body.cancelAtPeriodEnd).toBe(true);
      expect(res.body.cancelAt).toBe(new Date(cancelAt * 1000).toISOString());
      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_cancel');
    });

    it('returns cancelAtPeriodEnd false when subscription is active', async () => {
      const periodEnd = '2026-04-15T00:00:00.000Z';
      mockDb._setWhereResults([
        [
          {
            plan: 'pro',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_active',
            planPeriodEnd: periodEnd,
            billingInterval: 'monthly',
            paymentStatus: 'active',
          },
        ],
      ]);

      mockStripe.subscriptions.retrieve.mockResolvedValue({
        cancel_at_period_end: false,
        cancel_at: null,
      });

      const res = await request(app).get('/api/billing/status');

      expect(res.status).toBe(200);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.cancelAt).toBeNull();
    });

    it('defaults cancelAtPeriodEnd to false when Stripe retrieval fails', async () => {
      const periodEnd = '2026-04-15T00:00:00.000Z';
      mockDb._setWhereResults([
        [
          {
            plan: 'pro',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_fail',
            planPeriodEnd: periodEnd,
            billingInterval: 'monthly',
            paymentStatus: 'active',
          },
        ],
      ]);

      mockStripe.subscriptions.retrieve.mockRejectedValue(new Error('Stripe error'));

      const res = await request(app).get('/api/billing/status');

      expect(res.status).toBe(200);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(res.body.cancelAt).toBeNull();
    });
  });
});
