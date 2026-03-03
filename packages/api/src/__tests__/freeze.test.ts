import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateCalls: Array<{ set: Record<string, unknown>; table: string }> = [];
const selectResults: unknown[][] = [];
let selectCallIndex = 0;

const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

function resetMocks() {
  updateCalls.length = 0;
  selectResults.length = 0;
  selectCallIndex = 0;
  mockOrderBy.mockReset();
  mockLimit.mockReset();
  mockWhere.mockReset();
  mockFrom.mockReset();
  mockSet.mockReset();
  mockUpdateWhere.mockReset();

  mockUpdateWhere.mockResolvedValue(undefined);
  mockSet.mockImplementation((values: Record<string, unknown>) => {
    updateCalls.push({ set: values, table: 'unknown' });
    return { where: mockUpdateWhere };
  });

  mockLimit.mockImplementation(() => {
    return Promise.resolve(selectResults[selectCallIndex - 1] ?? []);
  });

  mockOrderBy.mockImplementation(() => {
    return { limit: mockLimit };
  });

  mockWhere.mockImplementation(() => {
    const idx = selectCallIndex++;
    const data = idx < selectResults.length ? selectResults[idx] : [];
    const result = Promise.resolve(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).orderBy = mockOrderBy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).limit = mockLimit;
    return result;
  });

  mockFrom.mockReturnValue({ where: mockWhere });
}

vi.mock('../db/pg-index.js', () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({ from: mockFrom })),
    update: vi.fn().mockImplementation(() => ({ set: mockSet })),
  },
}));

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

beforeEach(() => {
  resetMocks();
  vi.clearAllMocks();
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({ from: mockFrom }));
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({ set: mockSet }));
});

describe('freezeExcessItems', () => {
  it('freezes excess habits when user has more than free limit', async () => {
    // Habits: 5 total, keep 3 oldest
    selectResults.push([{ count: 5 }], [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }]);

    // Tasks, meetings, scheduling links: all under limit
    selectResults.push([{ count: 2 }], [{ count: 1 }], [{ count: 0 }]);

    await freezeExcessItems('user-1', 'free');

    expect(db.update).toHaveBeenCalled();

    const enableTrueCalls = updateCalls.filter((c) => c.set.enabled === true);
    const enableFalseCalls = updateCalls.filter((c) => c.set.enabled === false);
    expect(enableTrueCalls.length).toBeGreaterThanOrEqual(1);
    expect(enableFalseCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does nothing when user is under limit', async () => {
    selectResults.push([{ count: 2 }], [{ count: 3 }], [{ count: 1 }], [{ count: 0 }]);

    await freezeExcessItems('user-1', 'free');

    const enableFalseCalls = updateCalls.filter((c) => c.set.enabled === false);
    expect(enableFalseCalls.length).toBe(0);
  });

  it('does nothing when plan is pro (unlimited)', async () => {
    await freezeExcessItems('user-1', 'pro');

    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('unfreezeAllItems', () => {
  it('sets enabled=true on all disabled items for the user', async () => {
    await unfreezeAllItems('user-1');

    expect(db.update).toHaveBeenCalledTimes(4);

    const allEnableTrue = updateCalls.every((c) => c.set.enabled === true);
    expect(allEnableTrue).toBe(true);
    expect(updateCalls.length).toBe(4);
  });
});
