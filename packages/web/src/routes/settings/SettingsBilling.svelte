<script lang="ts">
  import { billing } from '$lib/api';
  import type { BillingStatus } from '$lib/api';
  import { showSuccess, showError, showInfo } from '$lib/notifications.svelte';
  import { refreshToken } from '$lib/auth.svelte';
  import { subscribePlanUpdates } from '$lib/ws';
  import { onMount } from 'svelte';
  import CreditCard from 'lucide-svelte/icons/credit-card';
  import Crown from 'lucide-svelte/icons/crown';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
  import Loader from 'lucide-svelte/icons/loader';

  let status = $state<BillingStatus | null>(null);
  let loading = $state(true);
  let checkoutLoading = $state(false);

  onMount(async () => {
    // Handle billing redirect query params from Stripe checkout
    const params = new URLSearchParams(window.location.search);
    const billingResult = params.get('billing');
    if (billingResult) {
      // Clean URL immediately
      const url = new URL(window.location.href);
      url.searchParams.delete('billing');
      history.replaceState(null, '', url.pathname + url.search);

      if (billingResult === 'success') {
        // Refresh JWT so the updated plan is in the token
        await refreshToken();
        showSuccess('Upgrade successful! You now have Pro.');
      } else if (billingResult === 'cancel') {
        showInfo('Checkout cancelled. You can upgrade anytime.');
      }
    }

    try {
      status = await billing.status();
    } catch {
      showError('Failed to load billing info');
    } finally {
      loading = false;
    }
  });

  async function handleUpgrade(interval: 'monthly' | 'annual') {
    checkoutLoading = true;
    try {
      const { url } = await billing.checkout(interval);
      if (url) window.location.href = url;
    } catch {
      showError('Failed to start checkout');
    } finally {
      checkoutLoading = false;
    }
  }

  async function handleManage() {
    try {
      const { url } = await billing.portal();
      if (url) window.location.href = url;
    } catch {
      showError('Failed to open billing portal');
    }
  }

  const isPro = $derived(status?.plan === 'pro');
  const isTrial = $derived(status?.isTrial ?? false);
  const trialExpired = $derived(
    isTrial && status?.trialDaysRemaining != null && status?.trialDaysRemaining === 0,
  );

  $effect(() => {
    const unsubPlan = subscribePlanUpdates(async () => {
      await refreshToken();
      try {
        status = await billing.status();
      } catch {
        // Silently fail — billing section will show stale data
      }
    });
    return unsubPlan;
  });
</script>

<section aria-labelledby="billing-heading" class="settings-section">
  <h2 id="billing-heading" class="section-heading section-heading--icon">
    <CreditCard size={16} aria-hidden="true" /> Billing
  </h2>

  {#if loading}
    <p class="text-hint">Loading billing info...</p>
  {:else if status}
    {#if status.paymentStatus === 'past_due'}
      <div class="payment-banner payment-banner--warning" role="alert">
        <AlertTriangle size={16} />
        <div class="payment-banner-content">
          <p>
            Your last payment didn't go through. We're retrying automatically. Please update your
            payment method to avoid interruption.
          </p>
          <button class="payment-banner-btn" onclick={handleManage}>Update Payment Method</button>
        </div>
      </div>
    {:else if status.paymentStatus === 'failed'}
      <div class="payment-banner payment-banner--error" role="alert">
        <AlertTriangle size={16} />
        <div class="payment-banner-content">
          <p>Payment failed. Update your payment method to keep your Pro features.</p>
          <button class="payment-banner-btn payment-banner-btn--error" onclick={handleManage}
            >Update Payment Method</button
          >
        </div>
      </div>
    {/if}

    <div class="plan-badge" class:plan-badge--pro={isPro} class:plan-badge--trial={isTrial}>
      <Crown size={14} />
      {#if isTrial}
        <span
          >Pro Trial — {status.trialDaysRemaining}
          {status.trialDaysRemaining === 1 ? 'day' : 'days'} remaining</span
        >
      {:else}
        <span>{isPro ? 'Pro' : 'Free'} Plan</span>
      {/if}
    </div>

    {#if isPro && !isTrial}
      <div class="plan-details">
        {#if status.cancelAtPeriodEnd}
          <div class="cancel-warning" role="alert">
            <p class="cancel-warning-text">
              Your Pro plan will end on {new Date(
                status.cancelAt ?? status.periodEnd ?? '',
              ).toLocaleDateString()}. You'll be downgraded to Free after this date.
            </p>
            <button class="btn-resubscribe" onclick={handleManage}>
              Resubscribe <ExternalLink size={14} />
            </button>
          </div>
        {:else}
          <p class="text-hint">
            Billed {status.billingInterval === 'annual' ? 'annually' : 'monthly'}
            {#if status.periodEnd}
              &middot; Renews {new Date(status.periodEnd).toLocaleDateString()}
            {/if}
          </p>
        {/if}
        <button class="btn-cancel" onclick={handleManage}>
          Manage Subscription <ExternalLink size={14} />
        </button>
      </div>
    {:else}
      <div class="upgrade-options">
        {#if trialExpired}
          <p class="trial-expired-msg">Your trial has ended — upgrade to keep Pro features.</p>
        {:else if isTrial}
          <p class="text-hint">Upgrade now to keep Pro features after your trial ends.</p>
        {:else}
          <p class="text-hint">
            Unlock unlimited habits, tasks, meetings, calendars, analytics, and more.
          </p>
        {/if}
        <div class="price-cards">
          <button
            class="price-card"
            onclick={() => handleUpgrade('monthly')}
            disabled={checkoutLoading}
          >
            {#if checkoutLoading}
              <Loader size={20} class="spinning" />
              <span class="checkout-redirect">Redirecting to Stripe...</span>
            {:else}
              <span class="price">$9</span>
              <span class="interval">/month</span>
            {/if}
          </button>
          <button
            class="price-card price-card--recommended"
            onclick={() => handleUpgrade('annual')}
            disabled={checkoutLoading}
          >
            {#if checkoutLoading}
              <Loader size={20} class="spinning" />
              <span class="checkout-redirect">Redirecting to Stripe...</span>
            {:else}
              <span class="save-badge">Save 22%</span>
              <span class="price">$7</span>
              <span class="interval">/month, billed annually</span>
            {/if}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .section-heading--icon {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .plan-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-md);
    font-weight: 600;
    font-size: 0.875rem;
    background: var(--color-surface-hover);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-4);

    &--pro {
      background: var(--color-accent-muted);
      color: var(--color-accent);
    }

    &--trial {
      background: var(--color-warning-bg);
      color: var(--color-warning);
    }
  }

  .trial-expired-msg {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-danger);
    margin: 0 0 var(--space-2);
  }

  .cancel-warning {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-warning-bg);
    border: 1px solid var(--color-warning);
    margin-bottom: var(--space-3);
  }

  .cancel-warning-text {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-warning);
    margin: 0 0 var(--space-3);
  }

  .btn-resubscribe {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--transition-fast);

    &:hover {
      opacity: 0.9;
    }
  }

  .plan-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .upgrade-options {
    margin-top: var(--space-2);
  }

  .price-cards {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .price-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-6) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: border-color var(--transition-fast);
    position: relative;

    &:hover {
      border-color: var(--color-accent);
    }

    &--recommended {
      border-color: var(--color-accent);
      background: var(--color-accent-muted);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .price {
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .interval {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin-top: var(--space-1);
  }

  .save-badge {
    position: absolute;
    top: -0.625rem;
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--color-accent);
    color: var(--color-accent-text);
  }

  .checkout-redirect {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-top: var(--space-2);
  }

  .payment-banner {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    align-items: flex-start;

    &--warning {
      background: var(--color-warning-bg);
      border: 1px solid var(--color-warning);
      color: var(--color-warning);
    }

    &--error {
      background: var(--color-danger-muted);
      border: 1px solid var(--color-danger);
      color: var(--color-danger);
    }
  }

  .payment-banner-content {
    flex: 1;

    p {
      margin: 0 0 var(--space-3);
      font-size: 0.8125rem;
      font-weight: 500;
      line-height: 1.4;
    }
  }

  .payment-banner-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--color-warning);
    color: var(--color-accent-text);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--transition-fast);

    &:hover {
      opacity: 0.9;
    }

    &--error {
      background: var(--color-danger);
    }
  }
</style>
