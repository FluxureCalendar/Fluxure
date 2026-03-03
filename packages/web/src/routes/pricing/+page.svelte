<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { BRAND } from '@fluxure/shared';
  import { resolve } from '$app/paths';
  import { billing } from '$lib/api';
  import type { BillingStatus } from '$lib/api';
  import { onMount } from 'svelte';
  import Check from 'lucide-svelte/icons/check';
  import Minus from 'lucide-svelte/icons/minus';
  import Zap from 'lucide-svelte/icons/zap';

  let annual = $state(true);
  let billingStatus = $state<BillingStatus | null>(null);

  onMount(async () => {
    try {
      billingStatus = await billing.status();
    } catch {
      // Not logged in or billing unavailable — keep default behavior
    }
  });

  const userPlan = $derived(billingStatus?.plan ?? null);
  const userIsTrial = $derived(billingStatus?.isTrial ?? false);
  const userTrialDays = $derived(billingStatus?.trialDaysRemaining ?? null);

  const PRO_MONTHLY = 9;
  const PRO_ANNUAL = 7;

  let proPrice = $derived(annual ? PRO_ANNUAL : PRO_MONTHLY);

  type Tier = {
    name: string;
    description: string;
    price: string;
    period: string;
    features: string[];
    cta: string;
    href?: string;
    highlighted: boolean;
    disabled: boolean;
    badge?: string;
  };

  let tiers = $derived<Tier[]>([
    {
      name: 'Free',
      description: 'For individuals getting started with smart scheduling.',
      price: '$0',
      period: '/mo',
      features: [
        '3 habits',
        '5 tasks',
        '2 smart meetings',
        '1 calendar',
        '14-day scheduling window',
        '1 scheduling link',
        '2 templates',
        'Quality score (number only)',
        '24h change history',
      ],
      cta: 'Get Started Free',
      href: resolve('/login'),
      highlighted: false,
      disabled: false,
    },
    {
      name: 'Pro',
      description: 'For power users who want the full scheduling experience.',
      price: `$${proPrice}`,
      period: annual ? '/mo, billed annually' : '/mo',
      features: [
        'Unlimited habits',
        'Unlimited tasks',
        'Unlimited meetings',
        'Unlimited calendars',
        '90-day scheduling window',
        'Unlimited scheduling links',
        '8 templates',
        'Full quality breakdown + trend',
        'Full analytics (365 days)',
        '30-day change history',
        'No branding on booking',
        'Push sync',
      ],
      cta:
        userPlan === 'pro' && !userIsTrial
          ? 'Current Plan'
          : userIsTrial
            ? `${userTrialDays} days remaining — Upgrade Now`
            : userPlan === 'free'
              ? 'Upgrade Now'
              : 'Start 14-Day Free Trial',
      href:
        userPlan === 'pro' && !userIsTrial
          ? undefined
          : userPlan
            ? resolve('/settings') + '#billing'
            : resolve('/login'),
      highlighted: true,
      disabled: userPlan === 'pro' && !userIsTrial,
      badge: userPlan === 'pro' && !userIsTrial ? 'Current Plan' : 'Recommended',
    },
    {
      name: 'Team',
      description: 'For teams that want to coordinate schedules together.',
      price: 'Coming Soon',
      period: '',
      features: [
        'Everything in Pro',
        'Shared scheduling links',
        'Team analytics',
        'Manager dashboard',
        'SSO / SAML',
      ],
      cta: 'Join Waitlist',
      href: undefined,
      highlighted: false,
      disabled: true,
    },
  ]);

  type ComparisonRow = {
    feature: string;
    free: string;
    pro: string;
    team: string;
  };

  const comparison: ComparisonRow[] = [
    { feature: 'Habits', free: '3', pro: 'Unlimited', team: 'Unlimited' },
    { feature: 'Tasks', free: '5', pro: 'Unlimited', team: 'Unlimited' },
    { feature: 'Smart Meetings', free: '2', pro: 'Unlimited', team: 'Unlimited' },
    { feature: 'Calendars', free: '1', pro: 'Unlimited', team: 'Unlimited' },
    { feature: 'Scheduling Window', free: '14 days', pro: '90 days', team: '90 days' },
    { feature: 'Scheduling Links', free: '1', pro: 'Unlimited', team: 'Unlimited' },
    { feature: 'Templates', free: '2', pro: '8', team: '8' },
    {
      feature: 'Quality Score',
      free: 'Number only',
      pro: 'Full breakdown + trend',
      team: 'Full breakdown + trend',
    },
    { feature: 'Analytics', free: '--', pro: '365 days', team: '365 days' },
    { feature: 'Change History', free: '24 hours', pro: '30 days', team: '30 days' },
    {
      feature: 'Branding on Booking',
      free: 'Fluxure branding',
      pro: 'No branding',
      team: 'No branding',
    },
    { feature: 'Push Sync', free: '--', pro: 'Yes', team: 'Yes' },
    { feature: 'Shared Links', free: '--', pro: '--', team: 'Yes' },
    { feature: 'Team Analytics', free: '--', pro: '--', team: 'Yes' },
    { feature: 'Manager Dashboard', free: '--', pro: '--', team: 'Yes' },
    { feature: 'SSO / SAML', free: '--', pro: '--', team: 'Yes' },
  ];
</script>

<svelte:head>
  <title>{pageTitle('Pricing')}</title>
</svelte:head>

<div class="pricing-page">
  <!-- Nav -->
  <nav class="landing-nav" aria-label="Pricing navigation">
    <div class="landing-nav-inner">
      <a href={resolve('/')} class="landing-nav-brand">
        <span class="sidebar-logo">F</span>
        {BRAND.name}
      </a>
      <div class="landing-nav-actions">
        <a href={resolve('/login')} class="landing-nav-link">Sign in</a>
        <a href={resolve('/login')} class="landing-btn-cta">Get Started</a>
      </div>
    </div>
  </nav>

  <!-- Header -->
  <header class="pricing-header">
    <h1 class="pricing-title">Simple, transparent pricing</h1>
    <p class="pricing-subtitle">Start free. Upgrade when you need more power.</p>

    <!-- Annual/Monthly toggle -->
    <div class="billing-toggle">
      <button
        class="billing-option"
        class:active={!annual}
        onclick={() => {
          annual = false;
        }}
        type="button"
      >
        Monthly
      </button>
      <button
        class="billing-option"
        class:active={annual}
        onclick={() => {
          annual = true;
        }}
        type="button"
      >
        Annual
        <span class="billing-badge">Save 22%</span>
      </button>
    </div>
  </header>

  <!-- Tier Cards -->
  <section class="pricing-tiers" aria-label="Pricing tiers">
    {#each tiers as tier (tier.name)}
      <div class="tier-card" class:highlighted={tier.highlighted} class:disabled={tier.disabled}>
        {#if tier.badge}
          <div class="tier-badge">{tier.badge}</div>
        {/if}

        <div class="tier-header">
          <h2 class="tier-name">{tier.name}</h2>
          <p class="tier-description">{tier.description}</p>
        </div>

        <div class="tier-price">
          <span class="tier-amount">{tier.price}</span>
          {#if tier.period}
            <span class="tier-period">{tier.period}</span>
          {/if}
        </div>
        {#if tier.name === 'Pro'}
          <p class="trial-note">Includes 14-day free trial</p>
        {/if}

        {#if tier.disabled || !tier.href}
          <button
            class="tier-cta"
            class:tier-cta--primary={tier.highlighted}
            class:tier-cta--disabled={tier.disabled}
            disabled={tier.disabled}
            type="button"
          >
            {#if tier.highlighted}
              <Zap size={16} strokeWidth={2} />
            {/if}
            {tier.cta}
          </button>
        {:else}
          <a href={tier.href} class="tier-cta" class:tier-cta--primary={tier.highlighted}>
            {#if tier.highlighted}
              <Zap size={16} strokeWidth={2} />
            {/if}
            {tier.cta}
          </a>
        {/if}

        <ul class="tier-features">
          {#each tier.features as feature (feature)}
            <li>
              <Check size={16} strokeWidth={2} class="tier-check" />
              <span>{feature}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </section>

  <!-- Comparison Table -->
  <section class="comparison-section" aria-label="Feature comparison">
    <h2 class="comparison-title">Compare plans</h2>
    <div class="comparison-table-wrap">
      <table class="comparison-table">
        <thead>
          <tr>
            <th class="comparison-feature-col">Feature</th>
            <th>Free</th>
            <th class="comparison-pro-col">Pro</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          {#each comparison as row (row.feature)}
            <tr>
              <td class="comparison-feature">{row.feature}</td>
              <td
                >{#if row.free === '--'}<Minus
                    size={14}
                    strokeWidth={1.5}
                    class="comparison-dash"
                  />{:else}{row.free}{/if}</td
              >
              <td class="comparison-pro-col"
                >{#if row.pro === '--'}<Minus
                    size={14}
                    strokeWidth={1.5}
                    class="comparison-dash"
                  />{:else}{row.pro}{/if}</td
              >
              <td
                >{#if row.team === '--'}<Minus
                    size={14}
                    strokeWidth={1.5}
                    class="comparison-dash"
                  />{:else}{row.team}{/if}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Footer -->
  <footer class="landing-footer">
    <span>&copy; {new Date().getFullYear()} {BRAND.name}</span>
    <a href={resolve('/privacy')}>Privacy</a>
    <a href={resolve('/terms')}>Terms</a>
  </footer>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .pricing-page {
    min-height: 100vh;
    background: var(--color-bg);
  }

  // ---- Header ----

  .pricing-header {
    text-align: center;
    padding: calc(64px + var(--space-16)) var(--space-6) var(--space-10);
  }

  .pricing-title {
    font-size: 2.25rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--color-text);
    margin: 0 0 var(--space-3);
  }

  .pricing-subtitle {
    font-size: 1.125rem;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-8);
    line-height: 1.6;
  }

  // ---- Billing Toggle ----

  .billing-toggle {
    display: inline-flex;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: 3px;
    gap: 2px;
  }

  .billing-option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);

    &:hover:not(.active) {
      color: var(--color-text);
    }

    &.active {
      background: var(--color-accent);
      color: var(--color-accent-text);
    }
  }

  .billing-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: var(--color-success);
    color: var(--color-accent-text, #fff);
    letter-spacing: 0.01em;
  }

  .billing-option.active .billing-badge {
    background: color-mix(in srgb, var(--color-accent-text) 25%, transparent);
    color: var(--color-accent-text, #fff);
  }

  // ---- Tier Cards ----

  .pricing-tiers {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-6);
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 var(--space-6) var(--space-16);
  }

  .tier-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    padding: var(--space-8) var(--space-6);
    transition: border-color var(--transition-fast);

    &.highlighted {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 1px var(--color-accent);
    }

    &.disabled {
      opacity: 0.65;
    }
  }

  .tier-badge {
    position: absolute;
    top: calc(-1 * var(--space-3));
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-1) var(--space-4);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: var(--radius-full);
    white-space: nowrap;
    letter-spacing: 0.01em;
  }

  .tier-header {
    margin-bottom: var(--space-6);
  }

  .tier-name {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-2);
  }

  .tier-description {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin: 0;
  }

  .tier-price {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    margin-bottom: var(--space-6);
  }

  .tier-amount {
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-text);
    line-height: 1;
  }

  .tier-period {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .trial-note {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-accent);
    margin: calc(-1 * var(--space-4)) 0 var(--space-6);
  }

  // ---- CTA Button ----

  .tier-cta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    margin-bottom: var(--space-6);
    min-height: 44px;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
      border-color: var(--color-border-strong);
    }

    &--primary {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-text);

      &:hover {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
      }
    }

    &--disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }
  }

  // ---- Feature List ----

  .tier-features {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    flex: 1;

    li {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      line-height: 1.4;
    }
  }

  :global(.tier-check) {
    color: var(--color-success);
    flex-shrink: 0;
    margin-top: 1px;
  }

  .highlighted :global(.tier-check) {
    color: var(--color-accent);
  }

  // ---- Comparison Table ----

  .comparison-section {
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-10) var(--space-6) var(--space-16);
  }

  .comparison-title {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--color-text);
    margin: 0 0 var(--space-8);
    text-align: center;
  }

  .comparison-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
  }

  .comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;

    th,
    td {
      padding: var(--space-3) var(--space-4);
      text-align: left;
      border-bottom: 1px solid var(--color-border);
    }

    th {
      font-weight: 600;
      font-size: 0.8125rem;
      color: var(--color-text);
      background: var(--color-surface);
      position: sticky;
      top: 0;
    }

    td {
      color: var(--color-text-secondary);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    tbody tr:hover {
      background: var(--color-surface-hover);
    }
  }

  .comparison-feature-col {
    width: 30%;
  }

  .comparison-feature {
    font-weight: 500;
    color: var(--color-text) !important;
  }

  .comparison-pro-col {
    background: var(--color-accent-muted) !important;
  }

  :global(.comparison-dash) {
    color: var(--color-text-tertiary);
  }

  // ---- Mobile ----

  @include mobile {
    .pricing-header {
      padding: calc(64px + var(--space-10)) var(--space-4) var(--space-6);
    }

    .pricing-title {
      font-size: 1.75rem;
    }

    .pricing-subtitle {
      font-size: 1rem;
    }

    .pricing-tiers {
      grid-template-columns: 1fr;
      max-width: 420px;
      padding: 0 var(--space-4) var(--space-10);
    }

    .comparison-section {
      padding: var(--space-6) var(--space-4) var(--space-10);
    }

    .comparison-table {
      font-size: 0.75rem;

      th,
      td {
        padding: var(--space-2) var(--space-3);
      }
    }
  }
</style>
