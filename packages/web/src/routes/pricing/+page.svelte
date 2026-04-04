<script lang="ts">
  import { goto } from '$app/navigation';
  import { billing } from '$lib/api';
  import { getAuthState, isValidStripeUrl } from '$lib/auth.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { pageTitle } from '$lib/brand';
  import Check from 'lucide-svelte/icons/check';
  import Server from 'lucide-svelte/icons/server';
  import Cloud from 'lucide-svelte/icons/cloud';
  import Zap from 'lucide-svelte/icons/zap';

  const authState = getAuthState();

  let checkoutLoading = $state<string | null>(null);

  interface Tier {
    name: string;
    price: string;
    period: string;
    description: string;
    icon: typeof Server;
    features: string[];
    recommended?: boolean;
    action: string;
    actionFn: () => void;
  }

  const tiers: Tier[] = [
    {
      name: 'Self-Hosted',
      price: 'Free',
      period: 'forever',
      description: 'Run Fluxure on your own infrastructure.',
      icon: Server,
      features: [
        'Unlimited habits, tasks & meetings',
        'Full scheduling engine',
        'Google Calendar sync',
        'Schedule quality analytics',
        'Complete data ownership',
        'Community support',
      ],
      action: 'View on GitHub',
      actionFn: () => {
        window.open('https://github.com/fluxure/fluxure', '_blank');
      },
    },
    {
      name: 'Cloud Free',
      price: '$0',
      period: '/month',
      description: 'Get started with Fluxure Cloud.',
      icon: Cloud,
      features: [
        '3 habits',
        '10 tasks',
        '2 smart meetings',
        'Focus time scheduling',
        'Google Calendar sync',
        'Schedule quality score',
      ],
      action: 'Get started',
      actionFn: () => {
        goto('/signup');
      },
    },
    {
      name: 'Cloud Pro',
      price: '$9',
      period: '/month',
      description: 'Unlock the full power of Fluxure.',
      icon: Zap,
      recommended: true,
      features: [
        'Unlimited habits & tasks',
        'Unlimited smart meetings',
        'Public booking links',
        'Advanced analytics',
        'Priority scheduling',
        'Push notifications',
        'Email support',
      ],
      action: 'Upgrade to Pro',
      actionFn: async () => {
        if (!authState.isAuthenticated) {
          await goto('/signup');
          return;
        }
        checkoutLoading = 'pro';
        try {
          const { url } = await billing.checkout('monthly');
          if (!isValidStripeUrl(url)) {
            showToast('Invalid checkout URL', 'error');
            checkoutLoading = null;
            return;
          }
          window.location.href = url;
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Checkout failed', 'error');
          checkoutLoading = null;
        }
      },
    },
  ];
</script>

<svelte:head>
  <title>{pageTitle('Pricing')}</title>
</svelte:head>

<div class="pricing-page">
  <div class="pricing-header">
    <h1>Simple, transparent pricing</h1>
    <p>Start free. Upgrade when you're ready.</p>
  </div>

  <div class="pricing-grid">
    {#each tiers as tier (tier.name)}
      <div class="pricing-card" class:pricing-recommended={tier.recommended}>
        {#if tier.recommended}
          <div class="recommended-badge">Recommended</div>
        {/if}

        <div class="pricing-card-header">
          <tier.icon size={24} class="pricing-icon" />
          <h3>{tier.name}</h3>
          <div class="pricing-price">
            <span class="price-amount">{tier.price}</span>
            <span class="price-period">{tier.period}</span>
          </div>
          <p class="pricing-desc">{tier.description}</p>
        </div>

        <ul class="pricing-features">
          {#each tier.features as feature (feature)}
            <li>
              <Check size={16} class="check-icon" />
              <span>{feature}</span>
            </li>
          {/each}
        </ul>

        <button
          class="pricing-action"
          class:btn-primary={tier.recommended}
          class:btn-secondary={!tier.recommended}
          onclick={tier.actionFn}
          disabled={checkoutLoading === 'pro' && tier.recommended}
        >
          {checkoutLoading === 'pro' && tier.recommended ? 'Redirecting...' : tier.action}
        </button>
      </div>
    {/each}
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .pricing-page {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-10) var(--space-4);
  }

  .pricing-header {
    text-align: center;
    margin-bottom: var(--space-12);

    h1 {
      font-size: 1.75rem;
      margin-bottom: var(--space-2);
    }

    p {
      color: var(--color-text-tertiary);
      font-size: 0.9375rem;
    }
  }

  .pricing-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-6);

    @include tablet {
      grid-template-columns: 1fr;
      max-width: 380px;
      margin: 0 auto;
    }
  }

  .pricing-card {
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    position: relative;
    border-radius: var(--radius-lg);

    &.pricing-recommended {
      background: var(--color-surface);
      box-shadow: var(--shadow-sm);
    }
  }

  .recommended-badge {
    position: absolute;
    top: calc(-1 * var(--space-2));
    left: 50%;
    transform: translateX(-50%);
    color: var(--color-accent);
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  .pricing-card-header {
    margin-bottom: var(--space-6);

    :global(.pricing-icon) {
      color: var(--color-text-tertiary);
      margin-bottom: var(--space-3);
      opacity: 0.5;
    }

    h3 {
      font-size: 1.0625rem;
      margin-bottom: var(--space-2);
    }
  }

  .pricing-price {
    margin-bottom: var(--space-2);
  }

  .price-amount {
    font-family: $font-heading;
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .price-period {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  .pricing-desc {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    line-height: 1.5;
  }

  .pricing-features {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-6);
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    li {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      line-height: 1.5;

      :global(.check-icon) {
        color: var(--color-success);
        flex-shrink: 0;
        margin-top: 2px;
        opacity: 0.7;
      }
    }
  }

  .pricing-action {
    width: 100%;
    margin-top: auto;
  }
</style>
