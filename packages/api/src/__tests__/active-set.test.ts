import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, TEST_USER_ID } from './helpers.js';

// ── Sentinel predicate wrappers ───────────────────────────────
// Override drizzle-orm's eq / and / inArray so the WHERE argument
// passed to update().set().where() has an inspectable structure.
// All other exports (count, sql, …) are forwarded from the real module.
// This lets the cross-tenant test assert userId scoping without relying
// on Drizzle internals, while every other test is unaffected (none of
// them inspect the WHERE argument content).
vi.mock('drizzle-orm', async (importActual) => {
  const real = await importActual<typeof import('drizzle-orm')>();
  return {
    ...real,
    eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
    and: (...args: unknown[]) => ({ __and: args }),
    inArray: (col: unknown, vals: unknown) => ({ __inArray: [col, vals] }),
  };
});

// ── Hoisted mocks ─────────────────────────────────────────────

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

const { mockBroadcastToUser } = vi.hoisted(() => {
  const mockBroadcastToUser = vi.fn();
  return { mockBroadcastToUser };
});

const { configState } = vi.hoisted(() => {
  const configState = {
    selfHosted: false,
  };
  return { configState };
});

// ── Module mocks ──────────────────────────────────────────────

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../ws.js', () => ({
  broadcastToUser: mockBroadcastToUser,
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
vi.mock('../config.js', () => ({
  getStripeSecretKey: () => '',
  getStripeProMonthlyPriceId: () => '',
  getStripeProAnnualPriceId: () => '',
  get CORS_ORIGIN() {
    return 'http://localhost:5173';
  },
  get FRONTEND_URL() {
    return 'http://localhost:5173';
  },
  isSelfHosted: () => configState.selfHosted,
}));
vi.mock('stripe', () => {
  function StripeMock() {
    return {};
  }
  return { default: StripeMock };
});

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

// ── Helpers ───────────────────────────────────────────────────

function resetMocks() {
  vi.clearAllMocks();
  configState.selfHosted = false;
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
  // Reset transaction to pass-through (re-use shared mockFrom/mockSet/mockWhere)
  mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: vi.fn().mockReturnValue({ from: (mockDb as any)._mockFrom }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: vi.fn().mockReturnValue({ values: (mockDb as any)._mockValues }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: vi.fn().mockReturnValue({ set: (mockDb as any)._mockSet }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete: vi.fn().mockReturnValue({ where: (mockDb as any)._mockDeleteWhere }),
    };
    return fn(tx);
  });
}

function makeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'free',
    planPeriodEnd: null,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

// Valid RFC 4122 v4 UUIDs (version=4, variant=8/9/a/b)
const UUID_1 = 'a0000001-0000-4000-8000-000000000001';
const UUID_2 = 'a0000002-0000-4000-8000-000000000002';
const UUID_3 = 'a0000003-0000-4000-8000-000000000003';
const UUID_OTHER_USER = 'b0000099-0000-4000-9000-000000000099';

// ── Tests ─────────────────────────────────────────────────────

describe('POST /api/billing/active-set', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    const { default: billingRouter } = await import('../routes/billing.js');
    app = createTestApp('billing', billingRouter);
  });

  beforeEach(resetMocks);

  // ────────────────────────────────────────────────────────────
  // Case 1: Self-hosted → 400, no DB writes
  // ────────────────────────────────────────────────────────────
  it('returns 400 when isSelfHosted() is true, with no DB writes', async () => {
    configState.selfHosted = true;

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: [UUID_1], freeze: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('All items are active on your plan');
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Case 2: Pro user (unlimited limit = -1) → 400
  // ────────────────────────────────────────────────────────────
  it('returns 400 when the effective plan is pro (unlimited limit for type)', async () => {
    // Pro plan with active stripe subscription → getEffectivePlan returns 'pro'
    mockDb._setWhereResults([
      [makeUserRow({ plan: 'pro', stripeSubscriptionId: 'sub_123', planPeriodEnd: null })],
    ]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: [UUID_1], freeze: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('All items are active on your plan');
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Case 3: Free user, activate within limit → 200
  // ────────────────────────────────────────────────────────────
  it('returns 200 { ok: true } and calls broadcastToUser when within limit', async () => {
    // Free user: maxHabits = 3
    // Call sequence: [0] user lookup, [1] count query in tx
    // After activating UUID_1, active count = 1 (within limit of 3)
    mockDb._setWhereResults([
      [makeUserRow()], // user lookup
      [{ value: 1 }], // count() in transaction
    ]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: [UUID_1], freeze: [UUID_2] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockBroadcastToUser).toHaveBeenCalledWith(
      expect.any(String),
      'plan_updated',
      'Active items updated',
      {},
    );
    // Transaction was invoked
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // The tx reuses mockDb._mockSet — verify it was called for activate and freeze
    // set() is called by tx.update().set() — which shares the same mockDb._mockSet mock
    const setCalls = mockDb._mockSet.mock.calls;
    expect(setCalls.length).toBeGreaterThanOrEqual(2);
    // enabled should never be written — only frozen
    setCalls.forEach((call: unknown[]) => {
      expect(call[0]).not.toHaveProperty('enabled');
      expect(call[0]).toHaveProperty('frozen');
    });
  });

  // ────────────────────────────────────────────────────────────
  // Case 3b: Only activate IDs (no freeze)
  // ────────────────────────────────────────────────────────────
  it('only calls update once when freeze list is empty', async () => {
    mockDb._setWhereResults([
      [makeUserRow()], // user lookup
      [{ value: 2 }], // count result — within limit 3
    ]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: [UUID_1, UUID_2], freeze: [] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // One set() call for activate, none for freeze — tx.update().set() uses shared mockDb._mockSet
    expect(mockDb._mockSet.mock.calls.length).toBe(1);
    expect(mockDb._mockSet.mock.calls[0][0]).toEqual({ frozen: false });
  });

  // ────────────────────────────────────────────────────────────
  // Case 4: Free user, resulting active count exceeds limit → 409
  // ────────────────────────────────────────────────────────────
  it('returns 409 when resulting active count would exceed the plan limit', async () => {
    // Free plan: maxHabits = 3. After activating 3, count = 4 → exceeds limit
    mockDb._setWhereResults([
      [makeUserRow()], // user lookup
      [{ value: 4 }], // count() — exceeds maxHabits=3
    ]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: [UUID_1, UUID_2, UUID_3], freeze: [] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/exceed.*plan limit/i);
    // broadcastToUser must NOT have been called
    expect(mockBroadcastToUser).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Case 5: Cross-tenant safety — WHERE clause scoped by userId
  // ────────────────────────────────────────────────────────────
  it('scopes all updates to the authenticated userId (cross-tenant safety)', async () => {
    mockDb._setWhereResults([
      [makeUserRow()], // user lookup
      [{ value: 1 }], // count — within limit
    ]);

    const activateIds = [UUID_OTHER_USER];
    await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'task', activate: activateIds, freeze: [] });

    // _mockWhereReturning captures the predicate passed to update().set().where().
    // With the drizzle-orm sentinel mock, each call produces:
    //   { __and: [{ __eq: [col, val] }, { __inArray: [col, ids] }] }
    // We assert that every update WHERE predicate:
    //   1. Is an __and sentinel (combined condition, never a bare unrestricted update)
    //   2. Contains an __eq whose value equals the AUTHENTICATED caller's userId
    //      (TEST_USER_ID = 'test-user-id') — not any other tenant's id
    //   3. Contains an __inArray over the submitted ids
    const whereReturnCalls = mockDb._mockWhereReturning.mock.calls;
    expect(whereReturnCalls.length).toBeGreaterThan(0);

    for (const call of whereReturnCalls as unknown[][]) {
      const pred = call[0] as { __and: unknown[] };

      // Must be an AND predicate (not a bare single-field match)
      expect(pred).toHaveProperty('__and');
      expect(Array.isArray(pred.__and)).toBe(true);

      // Extract the __eq and __inArray children from the AND
      const eqChild = pred.__and.find(
        (c): c is { __eq: [unknown, unknown] } =>
          typeof c === 'object' && c !== null && '__eq' in c,
      );
      const inArrayChild = pred.__and.find(
        (c): c is { __inArray: [unknown, unknown[]] } =>
          typeof c === 'object' && c !== null && '__inArray' in c,
      );

      // The eq sentinel must exist and its value must be the caller's userId,
      // NOT UUID_OTHER_USER or any other tenant's id.
      expect(eqChild).toBeDefined();
      expect(eqChild!.__eq[1]).toBe(TEST_USER_ID);
      expect(eqChild!.__eq[1]).not.toBe(UUID_OTHER_USER);

      // The inArray sentinel must exist and contain the submitted ids
      expect(inArrayChild).toBeDefined();
      expect(inArrayChild!.__inArray[1]).toEqual(activateIds);
    }
  });

  // ────────────────────────────────────────────────────────────
  // Case 6a: Invalid body — non-UUID in activate
  // ────────────────────────────────────────────────────────────
  it('returns 400 for non-UUID ids in activate', async () => {
    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: ['not-a-uuid'], freeze: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid active-set request');
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Case 6b: Invalid body — overlapping activate/freeze
  // ────────────────────────────────────────────────────────────
  it('returns 400 when activate and freeze share an id', async () => {
    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'task', activate: [UUID_1], freeze: [UUID_1] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid active-set request');
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Case 6c: Invalid body — unknown type
  // ────────────────────────────────────────────────────────────
  it('returns 400 for an unknown item type', async () => {
    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'focustime', activate: [UUID_1], freeze: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid active-set request');
  });

  // ────────────────────────────────────────────────────────────
  // Case 7: User not found → 404
  // ────────────────────────────────────────────────────────────
  it('returns 404 when user row is not found', async () => {
    mockDb._setWhereResults([[]]); // user lookup returns nothing

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'habit', activate: [UUID_1], freeze: [] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // Case 8: Task type works (different table, limit 5)
  // ────────────────────────────────────────────────────────────
  it('handles task type within free limit of 5', async () => {
    mockDb._setWhereResults([
      [makeUserRow()], // user lookup
      [{ value: 3 }], // count — within maxTasks=5
    ]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'task', activate: [UUID_1, UUID_2, UUID_3], freeze: [] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // Case 9: calendar type works
  // ────────────────────────────────────────────────────────────
  it('handles calendar type (maxCalendars=1 on free)', async () => {
    // Free plan: maxCalendars = 1. Active count = 1 → within limit
    mockDb._setWhereResults([[makeUserRow()], [{ value: 1 }]]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'calendar', activate: [UUID_1], freeze: [UUID_2] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockBroadcastToUser).toHaveBeenCalledWith(
      expect.any(String),
      'plan_updated',
      expect.any(String),
      expect.any(Object),
    );
  });

  // ────────────────────────────────────────────────────────────
  // Case 10: calendar type exceeds free limit of 1 → 409
  // ────────────────────────────────────────────────────────────
  it('returns 409 when calendar type would exceed free limit of 1', async () => {
    mockDb._setWhereResults([
      [makeUserRow()],
      [{ value: 2 }], // count = 2 > maxCalendars=1
    ]);

    const res = await request(app)
      .post('/api/billing/active-set')
      .send({ type: 'calendar', activate: [UUID_1, UUID_2], freeze: [] });

    expect(res.status).toBe(409);
    expect(mockBroadcastToUser).not.toHaveBeenCalled();
  });
});
