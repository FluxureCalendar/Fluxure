import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SettingsBilling from '../routes/settings/SettingsBilling.svelte';

vi.mock('$lib/api', () => ({
  billing: {
    status: vi.fn(),
    activeSet: vi.fn(),
    checkout: vi.fn(),
    portal: vi.fn(),
  },
  habits: { list: vi.fn() },
  tasks: { list: vi.fn() },
  meetings: { list: vi.fn() },
  links: { list: vi.fn() },
  calendars: { list: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

vi.mock('$lib/auth.svelte', () => ({
  isValidStripeUrl: vi.fn(() => true),
}));

vi.mock('$lib/toast.svelte', () => ({
  showToast: vi.fn(),
}));

import { billing, habits, tasks, meetings, links, calendars } from '$lib/api';

function makeFreeLimits(overrides: Record<string, number> = {}) {
  return {
    maxHabits: 3,
    maxTasks: 5,
    maxMeetings: 2,
    meetingsEnabled: false,
    focusTimeEnabled: false,
    maxCalendars: 1,
    maxSchedulingLinks: 1,
    maxTemplates: 2,
    schedulingWindowDays: 14,
    analyticsEnabled: false,
    analyticsMaxDays: 0,
    changeHistoryDays: 1,
    activityLogEnabled: false,
    qualityScoreBreakdown: false,
    qualityScoreTrend: false,
    bookingPageBranding: true,
    pushNotifications: false,
    prioritySupport: false,
    ...overrides,
  };
}

function makeBillingStatus(overrides = {}) {
  return {
    plan: 'free',
    selfHosted: false,
    hasSubscription: false,
    isTrial: false,
    trialDaysRemaining: null,
    billingInterval: null,
    periodEnd: null,
    paymentStatus: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    limits: makeFreeLimits(),
    ...overrides,
  };
}

describe('SettingsBilling — manage active items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    // Default: all non-habit lists return empty
    vi.mocked(tasks.list).mockResolvedValue([]);
    vi.mocked(meetings.list).mockResolvedValue([]);
    vi.mocked(links.list).mockResolvedValue([]);
    vi.mocked(calendars.list).mockResolvedValue([]);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders the "Manage active items" section for a Free, non-self-hosted user', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ limits: makeFreeLimits({ maxHabits: 1 }) }),
    );
    vi.mocked(habits.list).mockResolvedValue([
      { id: 'h1', name: 'Morning run', frozen: false } as never,
      { id: 'h2', name: 'Evening read', frozen: true } as never,
    ]);

    render(SettingsBilling);

    await waitFor(() => {
      expect(screen.getByText('Manage active items')).toBeInTheDocument();
    });
  });

  it('Freeze button is NOT disabled for an active habit when at the active-item limit', async () => {
    // maxHabits=1, 1 active + 1 frozen → at limit
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ limits: makeFreeLimits({ maxHabits: 1 }) }),
    );
    vi.mocked(habits.list).mockResolvedValue([
      { id: 'h1', name: 'Morning run', frozen: false } as never,
      { id: 'h2', name: 'Evening read', frozen: true } as never,
    ]);

    render(SettingsBilling);

    await waitFor(() => {
      expect(screen.getByText('Manage active items')).toBeInTheDocument();
    });

    const freezeBtn = screen.getByRole('button', { name: 'Freeze Morning run' });
    expect(freezeBtn).not.toBeDisabled();
  });

  it('clicking Freeze at the limit calls billing.activeSet with the correct args (regression)', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ limits: makeFreeLimits({ maxHabits: 1 }) }),
    );
    vi.mocked(habits.list).mockResolvedValue([
      { id: 'h1', name: 'Morning run', frozen: false } as never,
      { id: 'h2', name: 'Evening read', frozen: true } as never,
    ]);
    vi.mocked(billing.activeSet).mockResolvedValue({ ok: true });
    // refreshType calls habits.list again after toggle
    vi.mocked(habits.list)
      .mockResolvedValueOnce([
        { id: 'h1', name: 'Morning run', frozen: false } as never,
        { id: 'h2', name: 'Evening read', frozen: true } as never,
      ])
      .mockResolvedValue([
        { id: 'h1', name: 'Morning run', frozen: true } as never,
        { id: 'h2', name: 'Evening read', frozen: true } as never,
      ]);

    render(SettingsBilling);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Freeze Morning run' })).toBeInTheDocument();
    });

    const freezeBtn = screen.getByRole('button', { name: 'Freeze Morning run' });
    await fireEvent.click(freezeBtn);

    await waitFor(() => {
      expect(vi.mocked(billing.activeSet)).toHaveBeenCalledWith('habit', [], ['h1']);
    });
  });

  it('Activate button IS disabled for a frozen habit when at the active-item limit', async () => {
    // maxHabits=1, 1 active + 1 frozen → at limit; Activate would push over
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ limits: makeFreeLimits({ maxHabits: 1 }) }),
    );
    vi.mocked(habits.list).mockResolvedValue([
      { id: 'h1', name: 'Morning run', frozen: false } as never,
      { id: 'h2', name: 'Evening read', frozen: true } as never,
    ]);

    render(SettingsBilling);

    await waitFor(() => {
      expect(screen.getByText('Manage active items')).toBeInTheDocument();
    });

    const activateBtn = screen.getByRole('button', { name: 'Activate Evening read' });
    expect(activateBtn).toBeDisabled();
  });

  it('does not render the manage section for a self-hosted user', async () => {
    vi.mocked(billing.status).mockResolvedValue(makeBillingStatus({ selfHosted: true }));
    vi.mocked(habits.list).mockResolvedValue([]);

    const { container } = render(SettingsBilling);

    await waitFor(() => {
      // loading state clears
      expect(container.querySelector('.plan-card')).not.toBeNull();
    });

    expect(screen.queryByText('Manage active items')).toBeNull();
  });

  it('does not render the manage section for a Pro user', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ plan: 'pro', hasSubscription: true }),
    );
    vi.mocked(habits.list).mockResolvedValue([]);

    const { container } = render(SettingsBilling);

    await waitFor(() => {
      expect(container.querySelector('.plan-card')).not.toBeNull();
    });

    expect(screen.queryByText('Manage active items')).toBeNull();
  });
});
