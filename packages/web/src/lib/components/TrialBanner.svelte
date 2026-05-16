<script lang="ts">
  import { onMount } from 'svelte';
  import { billing, type BillingStatus } from '$lib/api';
  import { subscribePlanUpdates } from '$lib/ws';

  let status = $state<BillingStatus | null>(null);
  let dismissed = $state(
    typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem('trial-banner-dismissed') === '1',
  );

  const expired = $derived(
    !!status &&
      !status.selfHosted &&
      status.plan === 'free' &&
      !status.hasSubscription &&
      !status.isTrial &&
      !!status.periodEnd &&
      new Date(status.periodEnd).getTime() < Date.now(),
  );

  const tone = $derived(
    !status
      ? 'none'
      : expired
        ? 'red'
        : status.selfHosted || (status.plan === 'pro' && status.hasSubscription)
          ? 'none'
          : !status.isTrial
            ? 'none'
            : (status.trialDaysRemaining ?? 99) <= 3
              ? 'amber'
              : 'neutral',
  );

  async function load() {
    try {
      status = await billing.status();
    } catch {
      status = null;
    }
  }

  onMount(load);

  $effect(() => {
    const unsub = subscribePlanUpdates(() => {
      load();
    });
    return () => unsub();
  });
</script>

{#if tone === 'red'}
  <div class="trial-banner red" role="status" aria-live="polite">
    <span>Your Pro access has ended — items beyond the Free plan are paused.</span>
    <a href="/settings?billing=upgrade">Upgrade</a>
  </div>
{:else if status && status.isTrial && status.trialDaysRemaining !== null && tone !== 'none' && !dismissed}
  <div class="trial-banner" class:amber={tone === 'amber'} role="status" aria-live="polite">
    <span>
      {status.trialDaysRemaining} day{status.trialDaysRemaining === 1 ? '' : 's'} left in your Pro trial
    </span>
    <a href="/settings?billing=upgrade">Upgrade</a>
    <button
      type="button"
      aria-label="Dismiss trial banner"
      onclick={() => {
        dismissed = true;
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('trial-banner-dismissed', '1'); // survive hard refresh within the session
        }
      }}
    >
      ×
    </button>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .trial-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    background: var(--color-accent-muted);
    color: var(--color-text);
    font-size: 0.8125rem;

    a {
      color: var(--color-accent);
      font-weight: 600;
    }

    button {
      margin-left: auto;
      background: none;
      border: 0;
      cursor: pointer;
      color: inherit;
      font-size: 1rem;
      line-height: 1;
    }

    &.amber {
      background: var(--color-warning-amber-bg);
      color: var(--color-warning-amber);

      a {
        color: var(--color-warning-amber);
        text-decoration: underline;
      }
    }

    &.red {
      background: var(--color-danger-muted);
      color: var(--color-danger);

      a {
        color: var(--color-danger);
        font-weight: 600;
        text-decoration: underline;
      }
    }
  }
</style>
