import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import TrialBanner from '$lib/components/TrialBanner.svelte';

// Mock $lib/api
vi.mock('$lib/api', () => ({
  billing: {
    status: vi.fn(),
  },
}));

// Mock $lib/ws — factory must not reference hoisted variables
vi.mock('$lib/ws', () => ({
  subscribePlanUpdates: vi.fn(() => vi.fn()),
}));

import { billing } from '$lib/api';
import { subscribePlanUpdates } from '$lib/ws';

function makeBillingStatus(
  overrides: Partial<{
    selfHosted: boolean;
    plan: string;
    hasSubscription: boolean;
    isTrial: boolean;
    trialDaysRemaining: number | null;
    periodEnd: string | null;
  }>,
) {
  return {
    selfHosted: false,
    plan: 'free',
    hasSubscription: false,
    isTrial: false,
    trialDaysRemaining: null,
    billingInterval: null,
    periodEnd: null,
    paymentStatus: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    limits: {} as import('@fluxure/shared').PlanLimits,
    ...overrides,
  };
}

const PAST_ISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

describe('TrialBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(subscribePlanUpdates).mockReturnValue(vi.fn());
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders nothing when selfHosted=true', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ selfHosted: true, isTrial: true, trialDaysRemaining: 10 }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  it('renders nothing when paid Pro (plan=pro, hasSubscription=true)', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ plan: 'pro', hasSubscription: true, isTrial: false }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  it('renders nothing when not a trial', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: false, trialDaysRemaining: null }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  it('shows days remaining text with neutral tone when >3 days left', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 10 }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      const banner = container.querySelector('.trial-banner');
      expect(banner).not.toBeNull();
      expect(banner!.textContent).toContain('10 days left');
      expect(banner!.classList.contains('amber')).toBe(false);
    });
  });

  it('uses plural "days" for counts other than 1', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 5 }),
    );

    render(TrialBanner);

    await waitFor(() => {
      expect(screen.getByText(/5 days left/)).toBeInTheDocument();
    });
  });

  it('uses singular "day" when 1 day remains', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 1 }),
    );

    render(TrialBanner);

    await waitFor(() => {
      expect(screen.getByText(/1 day left/)).toBeInTheDocument();
    });
  });

  it('applies amber class when ≤3 days remain', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 2 }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      const banner = container.querySelector('.trial-banner');
      expect(banner).not.toBeNull();
      expect(banner!.classList.contains('amber')).toBe(true);
    });
  });

  it('applies amber class at exactly 3 days remain', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 3 }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      const banner = container.querySelector('.trial-banner');
      expect(banner).not.toBeNull();
      expect(banner!.classList.contains('amber')).toBe(true);
    });
  });

  it('renders an Upgrade link', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }),
    );

    render(TrialBanner);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Upgrade' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/settings?billing=upgrade');
    });
  });

  it('renders dismiss button with aria-label', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }),
    );

    render(TrialBanner);

    await waitFor(() => {
      const btn = screen.getByLabelText('Dismiss trial banner');
      expect(btn).toBeInTheDocument();
    });
  });

  it('hides banner after clicking dismiss button', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).not.toBeNull();
    });

    const btn = screen.getByLabelText('Dismiss trial banner');
    await fireEvent.click(btn);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  it('renders nothing when billing.status rejects', async () => {
    vi.mocked(billing.status).mockRejectedValue(new Error('Network error'));

    const { container } = render(TrialBanner);

    // Give the async load time to settle
    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  it('renders nothing when isTrial=true but trialDaysRemaining=null', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: null }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  it('sets sessionStorage key when dismiss button is clicked', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }),
    );

    render(TrialBanner);

    await waitFor(() => {
      expect(screen.getByLabelText('Dismiss trial banner')).toBeInTheDocument();
    });

    const btn = screen.getByLabelText('Dismiss trial banner');
    await fireEvent.click(btn);

    expect(sessionStorage.getItem('trial-banner-dismissed')).toBe('1');
  });

  it('does not render when sessionStorage already has trial-banner-dismissed=1 at mount', async () => {
    sessionStorage.setItem('trial-banner-dismissed', '1');

    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      // Status has loaded (mock resolves), but banner must not appear
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  // ─── Expired-trial (red) state ───────────────────────────────────────────────

  it('renders red banner with "trial has ended" text and Upgrade link for expired trial', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({
        plan: 'free',
        hasSubscription: false,
        isTrial: false,
        periodEnd: PAST_ISO,
        selfHosted: false,
      }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      const banner = container.querySelector('.trial-banner');
      expect(banner).not.toBeNull();
      expect(banner!.classList.contains('red')).toBe(true);
      expect(banner!.textContent).toContain('trial has ended');
    });

    const link = screen.getByRole('link', { name: 'Upgrade' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/settings?billing=upgrade');
  });

  it('red banner has no dismiss button', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({
        plan: 'free',
        hasSubscription: false,
        isTrial: false,
        periodEnd: PAST_ISO,
        selfHosted: false,
      }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner.red')).not.toBeNull();
    });

    expect(container.querySelector('button[aria-label="Dismiss trial banner"]')).toBeNull();
  });

  it('red banner renders even when sessionStorage dismissed flag is set', async () => {
    sessionStorage.setItem('trial-banner-dismissed', '1');

    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({
        plan: 'free',
        hasSubscription: false,
        isTrial: false,
        periodEnd: PAST_ISO,
        selfHosted: false,
      }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      const banner = container.querySelector('.trial-banner.red');
      expect(banner).not.toBeNull();
    });
  });

  it('renders nothing for a plain free user who never trialed (periodEnd=null)', async () => {
    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({
        plan: 'free',
        hasSubscription: false,
        isTrial: false,
        periodEnd: null,
        selfHosted: false,
      }),
    );

    const { container } = render(TrialBanner);

    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).toBeNull();
    });
  });

  // ─── plan_updated WS refresh ─────────────────────────────────────────────────

  it('subscribes to plan updates on mount and unsubscribes on destroy', async () => {
    const mockUnsub = vi.fn();
    vi.mocked(subscribePlanUpdates).mockReturnValue(mockUnsub);

    vi.mocked(billing.status).mockResolvedValue(
      makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }),
    );

    const { unmount } = render(TrialBanner);

    await waitFor(() => {
      expect(subscribePlanUpdates).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(mockUnsub).toHaveBeenCalledTimes(1);
  });

  it('re-fetches billing status when plan_updated event fires', async () => {
    let capturedHandler: ((data: { plan: string; paymentStatus: string | null }) => void) | null =
      null;

    vi.mocked(subscribePlanUpdates).mockImplementation((handler) => {
      capturedHandler = handler;
      return vi.fn();
    });

    vi.mocked(billing.status)
      .mockResolvedValueOnce(makeBillingStatus({ isTrial: true, trialDaysRemaining: 7 }))
      .mockResolvedValueOnce(
        makeBillingStatus({
          plan: 'free',
          hasSubscription: false,
          isTrial: false,
          periodEnd: PAST_ISO,
          selfHosted: false,
        }),
      );

    const { container } = render(TrialBanner);

    // Initial load: active trial banner
    await waitFor(() => {
      expect(container.querySelector('.trial-banner')).not.toBeNull();
      expect(container.querySelector('.trial-banner.red')).toBeNull();
    });

    // Simulate plan_updated WS event
    capturedHandler!({ plan: 'free', paymentStatus: null });

    // After re-fetch: red expired banner
    await waitFor(() => {
      expect(container.querySelector('.trial-banner.red')).not.toBeNull();
    });

    expect(billing.status).toHaveBeenCalledTimes(2);
  });
});
