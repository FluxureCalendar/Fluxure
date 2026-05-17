<script lang="ts">
  import { onMount } from 'svelte';
  import {
    billing,
    habits,
    tasks,
    meetings,
    links,
    calendars,
    type BillingStatus,
    ApiError,
  } from '$lib/api';
  import { isValidStripeUrl } from '$lib/auth.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { isUnlimited } from '@fluxure/shared';

  import Check from 'lucide-svelte/icons/check';
  import Crown from 'lucide-svelte/icons/crown';
  import Zap from 'lucide-svelte/icons/zap';
  import CreditCard from 'lucide-svelte/icons/credit-card';
  import { APP_NAME } from '$lib/brand';

  type ItemType = 'habit' | 'task' | 'meeting' | 'link' | 'calendar';

  interface ManagedItem {
    id: string;
    name: string;
    frozen: boolean;
  }

  interface TypeConfig {
    type: ItemType;
    label: string;
    limitKey: keyof import('@fluxure/shared').PlanLimits;
  }

  const TYPE_CONFIGS: TypeConfig[] = [
    { type: 'habit', label: 'Habits', limitKey: 'maxHabits' },
    { type: 'task', label: 'Tasks', limitKey: 'maxTasks' },
    { type: 'meeting', label: 'Meetings', limitKey: 'maxMeetings' },
    { type: 'link', label: 'Scheduling Links', limitKey: 'maxSchedulingLinks' },
    { type: 'calendar', label: 'Calendars', limitKey: 'maxCalendars' },
  ];

  let status = $state<BillingStatus | null>(null);
  let loading = $state(true);

  let itemsByType = $state<Record<ItemType, ManagedItem[]>>({
    habit: [],
    task: [],
    meeting: [],
    link: [],
    calendar: [],
  });
  let itemsLoading = $state(false);
  let togglingId = $state<string | null>(null);

  const PRO_FEATURES = [
    'Unlimited habits, tasks & meetings',
    'Unlimited calendars & scheduling links',
    '90-day scheduling window',
    'Full analytics & quality trends',
    'Activity log & 30-day change history',
    'Priority support',
  ];

  const showManageSection = $derived(
    status !== null && !status.selfHosted && status.plan !== 'pro',
  );

  function activeCount(type: ItemType): number {
    return itemsByType[type].filter((i) => !i.frozen).length;
  }

  function limitFor(type: ItemType): number {
    if (!status) return 0;
    const key = TYPE_CONFIGS.find((c) => c.type === type)!.limitKey;
    return status.limits[key] as number;
  }

  function isAtLimit(type: ItemType): boolean {
    const limit = limitFor(type);
    if (isUnlimited(limit)) return false;
    return activeCount(type) >= limit;
  }

  async function loadBilling() {
    try {
      status = await billing.status();
    } catch {
      // silent
    } finally {
      loading = false;
    }
  }

  async function loadItems() {
    itemsLoading = true;
    try {
      const [h, t, m, l, c] = await Promise.all([
        habits.list(),
        tasks.list(),
        meetings.list(),
        links.list(),
        calendars.list(),
      ]);
      itemsByType = {
        habit: h.map((x) => ({ id: x.id, name: x.name, frozen: x.frozen })),
        task: t.map((x) => ({ id: x.id, name: x.name, frozen: x.frozen })),
        meeting: m.map((x) => ({ id: x.id, name: x.name, frozen: x.frozen })),
        link: l.map((x) => ({ id: x.id, name: x.name, frozen: x.frozen })),
        calendar: c.map((x) => ({ id: x.id, name: x.name, frozen: x.frozen })),
      };
    } catch {
      // silent — section simply shows empty
    } finally {
      itemsLoading = false;
    }
  }

  async function refreshType(type: ItemType) {
    try {
      let updated: ManagedItem[] = [];
      if (type === 'habit')
        updated = (await habits.list()).map((x) => ({ id: x.id, name: x.name, frozen: x.frozen }));
      else if (type === 'task')
        updated = (await tasks.list()).map((x) => ({ id: x.id, name: x.name, frozen: x.frozen }));
      else if (type === 'meeting')
        updated = (await meetings.list()).map((x) => ({
          id: x.id,
          name: x.name,
          frozen: x.frozen,
        }));
      else if (type === 'link')
        updated = (await links.list()).map((x) => ({ id: x.id, name: x.name, frozen: x.frozen }));
      else if (type === 'calendar')
        updated = (await calendars.list()).map((x) => ({
          id: x.id,
          name: x.name,
          frozen: x.frozen,
        }));
      itemsByType = { ...itemsByType, [type]: updated };
    } catch {
      // silent
    }
  }

  async function toggleItem(type: ItemType, item: ManagedItem) {
    if (togglingId !== null) return;
    togglingId = item.id;
    try {
      if (item.frozen) {
        await billing.activeSet(type, [item.id], []);
      } else {
        await billing.activeSet(type, [], [item.id]);
      }
      await refreshType(type);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Plan limit reached — freeze another item first', 'error');
      } else if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to update item', 'error');
      }
    } finally {
      togglingId = null;
    }
  }

  async function handleUpgrade(interval: 'monthly' | 'annual') {
    try {
      const { url } = await billing.checkout(interval);
      if (!isValidStripeUrl(url)) {
        showToast('Invalid checkout URL', 'error');
        return;
      }
      window.location.href = url;
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to start checkout', 'error');
      }
    }
  }

  async function openPortal() {
    try {
      const { url } = await billing.portal();
      if (!isValidStripeUrl(url)) {
        showToast('Invalid billing portal URL', 'error');
        return;
      }
      window.location.href = url;
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to open billing portal', 'error');
      }
    }
  }

  onMount(() => {
    loadBilling();
  });

  $effect(() => {
    if (showManageSection) {
      loadItems();
    }
  });
</script>

<section class="settings-section" data-setting-id="billing-plan">
  <h3>Billing</h3>

  {#if loading}
    <p class="text-secondary">Loading...</p>
  {:else if status}
    <div class="plan-card plan-card-pro">
      <div class="plan-card-header">
        <div class="plan-badge-row">
          <Crown size={18} />
          <span class="plan-name"
            >{status.selfHosted ? 'Self-Hosted' : status.plan === 'pro' ? 'Pro' : 'Free'}</span
          >
        </div>
        {#if !status.selfHosted && status.isTrial && status.trialDaysRemaining !== null}
          <span class="trial-badge">Trial — {status.trialDaysRemaining} days left</span>
        {/if}
        {#if !status.selfHosted && status.cancelAtPeriodEnd}
          <span class="cancel-badge">Cancels at period end</span>
        {/if}
      </div>

      {#if status.selfHosted}
        <p class="plan-desc">
          You have full access to all {APP_NAME} features with your self-hosted installation.
        </p>
      {:else if status.plan === 'pro' && status.hasSubscription}
        <p class="plan-desc">You have full access to all {APP_NAME} features.</p>
        {#if status.periodEnd}
          <p class="period-info">
            Current period ends {new Date(status.periodEnd).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        {/if}
        <button class="btn-secondary manage-btn" onclick={openPortal}>
          <CreditCard size={14} />
          Manage subscription
        </button>
      {:else}
        <p class="plan-desc">You're on the Free plan with limited habits, tasks, and calendars.</p>
      {/if}
    </div>

    {#if !status.selfHosted && !(status.plan === 'pro' && status.hasSubscription)}
      <div class="upgrade-section">
        <h4>Upgrade to Pro</h4>
        <ul class="feature-list">
          {#each PRO_FEATURES as feature (feature)}
            <li class="feature-item">
              <span class="feature-check"><Check size={14} /></span>
              <span>{feature}</span>
            </li>
          {/each}
        </ul>

        <div class="pricing-cards">
          <button
            class="pricing-card pricing-card-highlight"
            onclick={() => handleUpgrade('annual')}
          >
            <span class="pricing-interval">Annual</span>
            <span class="pricing-amount">$7<span class="pricing-unit">/mo</span></span>
            <span class="pricing-save">Save 22%</span>
          </button>
          <button class="pricing-card" onclick={() => handleUpgrade('monthly')}>
            <span class="pricing-interval">Monthly</span>
            <span class="pricing-amount">$9<span class="pricing-unit">/mo</span></span>
            <span class="pricing-save">&nbsp;</span>
          </button>
        </div>
      </div>
    {/if}

    {#if showManageSection}
      <div class="manage-section">
        <h4>Manage active items</h4>
        <p class="manage-desc">
          Free plan limits how many items can be active at once. Freeze items to stay within your
          limits without deleting them.
        </p>

        {#if itemsLoading}
          <p class="text-secondary">Loading items...</p>
        {:else}
          {#each TYPE_CONFIGS as cfg (cfg.type)}
            {@const limit = limitFor(cfg.type)}
            {#if !isUnlimited(limit)}
              {@const items = itemsByType[cfg.type]}
              {#if items.length > 0}
                <div class="type-group">
                  <div class="type-header">
                    <span class="type-label">{cfg.label}</span>
                    <span class="type-count">{activeCount(cfg.type)} / {limit} active</span>
                  </div>
                  <ul class="item-list">
                    {#each items as item (item.id)}
                      <li class="item-row">
                        <span class="item-name" class:item-frozen={item.frozen}>{item.name}</span>
                        <button
                          type="button"
                          class="item-toggle"
                          class:item-toggle-freeze={!item.frozen}
                          disabled={togglingId !== null || (item.frozen && isAtLimit(cfg.type))}
                          aria-label={item.frozen ? `Activate ${item.name}` : `Freeze ${item.name}`}
                          onclick={() => toggleItem(cfg.type, item)}
                        >
                          {item.frozen ? 'Activate' : 'Freeze'}
                        </button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            {/if}
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-section {
    @include flex-col(var(--space-4));
  }

  .plan-card {
    @include flex-col(var(--space-3));
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }

  .plan-card-pro {
    border-color: var(--color-accent);
    background: var(--color-accent-muted);
  }

  .plan-card-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .plan-badge-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-accent);
  }

  .plan-name {
    font-family: $font-heading;
    font-weight: 600;
    font-size: 1.25rem;
    color: var(--color-text);
  }

  .trial-badge,
  .cancel-badge {
    @include badge;
    background: var(--color-warning-amber-bg);
    color: var(--color-warning-amber);
    font-size: 0.6875rem;
  }

  .plan-desc {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .period-info {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  .manage-btn {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .text-secondary {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .upgrade-section {
    @include flex-col(var(--space-4));
  }

  h4 {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
  }

  .feature-list {
    list-style: none;
    padding: 0;
    margin: 0;
    @include flex-col(var(--space-2));
  }

  .feature-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .feature-check {
    display: flex;
    color: var(--color-success);
    flex-shrink: 0;
  }

  .pricing-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .pricing-card {
    @include flex-col(var(--space-1));
    align-items: center;
    padding: var(--space-5) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    font-family: $font-body;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast);

    &:hover {
      border-color: var(--color-accent);
      background: var(--color-accent-muted);
    }
  }

  .pricing-card-highlight {
    border-color: var(--color-accent);
    background: var(--color-accent-muted);
    position: relative;
  }

  .pricing-interval {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .pricing-amount {
    font-family: $font-heading;
    font-weight: 600;
    font-size: 1.75rem;
    color: var(--color-text);
    letter-spacing: -0.02em;
  }

  .pricing-unit {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--color-text-secondary);
  }

  .pricing-save {
    font-size: 0.6875rem;
    color: var(--color-success);
    font-weight: 500;
  }

  .manage-section {
    @include flex-col(var(--space-4));
  }

  .manage-desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin-top: calc(-1 * var(--space-2));
  }

  .type-group {
    @include flex-col(var(--space-2));
  }

  .type-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .type-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .type-count {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .item-list {
    list-style: none;
    padding: 0;
    margin: 0;
    @include flex-col(0);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);

    & + & {
      border-top: 1px solid var(--color-border);
    }
  }

  .item-name {
    font-size: 0.8125rem;
    color: var(--color-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-frozen {
    color: var(--color-text-tertiary);
  }

  .item-toggle {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-2);
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
      border-color var(--transition-fast),
      color var(--transition-fast),
      background var(--transition-fast);
    font-family: $font-body;

    &:hover:not(:disabled) {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  .item-toggle-freeze {
    &:hover:not(:disabled) {
      border-color: var(--color-warning-amber);
      color: var(--color-warning-amber);
    }
  }
</style>
