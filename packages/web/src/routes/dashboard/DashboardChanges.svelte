<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { schedule } from '$lib/api';
  import { subscribe as subscribeWs } from '$lib/ws';
  import type { ScheduleChange } from '@fluxure/shared';
  import { ScheduleChangeType, differenceInMinutes } from '@fluxure/shared';
  import { fly } from 'svelte/transition';
  import History from 'lucide-svelte/icons/history';
  import Plus from 'lucide-svelte/icons/plus';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Check from 'lucide-svelte/icons/check';
  import Lock from 'lucide-svelte/icons/lock';
  import Unlock from 'lucide-svelte/icons/unlock';
  import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';

  let { userTimezone = '' } = $props();

  let recentChanges = $state<ScheduleChange[]>([]);
  let changesExpanded = $state(false);

  interface ChangeBatch {
    batchId: string;
    timestamp: string;
    changes: ScheduleChange[];
  }

  let changeBatches = $derived.by(() => {
    const map = new SvelteMap<string, ScheduleChange[]>();
    for (const c of recentChanges) {
      const existing = map.get(c.batchId);
      if (existing) {
        existing.push(c);
      } else {
        map.set(c.batchId, [c]);
      }
    }
    const batches: ChangeBatch[] = [];
    for (const [batchId, changes] of map) {
      batches.push({ batchId, timestamp: changes[0].createdAt, changes });
    }
    return batches;
  });

  let lastUpdatedAt = $derived(recentChanges.length > 0 ? recentChanges[0].createdAt : '');

  async function fetchChanges() {
    try {
      recentChanges = await schedule.getChanges(20);
    } catch {
      // Non-critical; silently ignore
    }
  }

  $effect(() => {
    fetchChanges();
  });

  // Listen for real-time schedule_changes events
  $effect(() => {
    const unsub = subscribeWs((msg) => {
      if (msg.type === 'schedule_changes' && Array.isArray(msg.data)) {
        recentChanges = [...msg.data, ...recentChanges].slice(0, 20);
      }
    });
    return () => unsub();
  });

  function formatTimeShort(iso: string): string {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone || undefined,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  }

  function formatDuration(startIso: string, endIso: string): string {
    const mins = differenceInMinutes(new Date(endIso), new Date(startIso));
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${mins}m`;
  }

  function describeChange(c: ScheduleChange): string {
    switch (c.operationType) {
      case ScheduleChangeType.Created:
        return `Added '${c.itemName}' at ${c.newStart ? formatTimeShort(c.newStart) : '?'}`;
      case ScheduleChangeType.Moved:
        return `Moved '${c.itemName}' from ${c.previousStart ? formatTimeShort(c.previousStart) : '?'} to ${c.newStart ? formatTimeShort(c.newStart) : '?'}`;
      case ScheduleChangeType.Resized: {
        if (c.previousStart && c.previousEnd && c.newStart && c.newEnd) {
          return `Resized '${c.itemName}' from ${formatDuration(c.previousStart, c.previousEnd)} to ${formatDuration(c.newStart, c.newEnd)}`;
        }
        return `Resized '${c.itemName}'`;
      }
      case ScheduleChangeType.Deleted:
        return `Removed '${c.itemName}'`;
      case ScheduleChangeType.Completed:
        return `Completed '${c.itemName}'`;
      case ScheduleChangeType.Locked:
        return `Locked '${c.itemName}'`;
      case ScheduleChangeType.Unlocked:
        return `Unlocked '${c.itemName}'`;
      default:
        return `Changed '${c.itemName}'`;
    }
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function changeIcon(type: ScheduleChangeType): typeof Plus {
    switch (type) {
      case ScheduleChangeType.Created:
        return Plus;
      case ScheduleChangeType.Moved:
        return ArrowRight;
      case ScheduleChangeType.Resized:
        return ArrowRight;
      case ScheduleChangeType.Deleted:
        return Trash2;
      case ScheduleChangeType.Completed:
        return Check;
      case ScheduleChangeType.Locked:
        return Lock;
      case ScheduleChangeType.Unlocked:
        return Unlock;
      default:
        return History;
    }
  }
</script>

{#if recentChanges.length > 0}
  <section class="changes-section" aria-labelledby="changes-heading">
    <button
      class="changes-toggle"
      onclick={() => {
        changesExpanded = !changesExpanded;
      }}
      aria-expanded={changesExpanded}
      aria-controls="changes-list"
    >
      <History size={14} strokeWidth={1.5} />
      <h2 id="changes-heading" class="changes-heading">Recent Changes</h2>
      <span class="changes-count">{recentChanges.length}</span>
      {#if !changesExpanded && lastUpdatedAt}
        <span class="changes-last-updated font-mono"
          >Last rescheduled {relativeTime(lastUpdatedAt)}</span
        >
      {/if}
      <ChevronsUpDown
        size={14}
        strokeWidth={1.5}
        class="changes-chevron {changesExpanded ? 'changes-chevron--expanded' : ''}"
      />
    </button>

    {#if changesExpanded}
      <div id="changes-list" class="changes-list" transition:fly={{ y: -4, duration: 150 }}>
        {#each changeBatches as batch (batch.batchId)}
          <div class="changes-batch">
            <div class="changes-batch-header">
              <span class="changes-batch-time font-mono">{relativeTime(batch.timestamp)}</span>
              <span class="changes-batch-count"
                >{batch.changes.length} change{batch.changes.length !== 1 ? 's' : ''}</span
              >
            </div>
            {#each batch.changes as change (change.id)}
              {@const IconComponent = changeIcon(change.operationType)}
              <div
                class="change-item"
                class:change-item--new={Date.now() - new Date(change.createdAt).getTime() < 5000}
              >
                <span
                  class="change-icon"
                  class:change-icon--created={change.operationType === ScheduleChangeType.Created}
                  class:change-icon--deleted={change.operationType === ScheduleChangeType.Deleted}
                  class:change-icon--moved={change.operationType === ScheduleChangeType.Moved ||
                    change.operationType === ScheduleChangeType.Resized}
                  class:change-icon--completed={change.operationType ===
                    ScheduleChangeType.Completed}
                  class:change-icon--locked={change.operationType === ScheduleChangeType.Locked ||
                    change.operationType === ScheduleChangeType.Unlocked}
                >
                  <IconComponent size={12} strokeWidth={2} />
                </span>
                <span class="change-desc">
                  {describeChange(change)}
                  {#if change.reason}
                    <span class="change-reason">({change.reason})</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .changes-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .changes-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    text-align: left;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  .changes-heading {
    font-family: $font-body;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
    flex: 1;
  }

  .changes-count {
    font-size: 0.6875rem;
    font-weight: 500;
    background: var(--color-accent-muted);
    color: var(--color-accent);
    padding: 1px 6px;
    border-radius: var(--radius-full);
  }

  .changes-last-updated {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  :global(.changes-chevron) {
    flex-shrink: 0;
    opacity: 0.5;
    transition: transform 200ms ease;
  }

  :global(.changes-chevron--expanded) {
    transform: rotate(180deg);
  }

  .changes-list {
    border-top: 1px solid var(--color-border);
  }

  .changes-batch {
    padding: var(--space-3) var(--space-4);

    & + & {
      border-top: 1px solid var(--color-border);
    }
  }

  .changes-batch-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .changes-batch-time {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .changes-batch-count {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .change-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: 3px 0;

    &--new {
      animation: change-flash 1s ease-out;
    }
  }

  @keyframes change-flash {
    from {
      background: var(--color-accent-muted);
    }
    to {
      background: transparent;
    }
  }

  .change-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    margin-top: 1px;

    &--created {
      color: var(--color-success);
      background: var(--color-success-muted);
    }

    &--deleted {
      color: var(--color-danger);
      background: var(--color-danger-muted);
    }

    &--moved {
      color: var(--color-accent);
      background: var(--color-accent-muted);
    }

    &--completed {
      color: var(--color-success);
      background: var(--color-success-muted);
    }

    &--locked {
      color: var(--color-warning);
      background: var(--color-warning-muted);
    }
  }

  .change-desc {
    font-size: 0.75rem;
    color: var(--color-text);
    line-height: 1.4;
  }

  .change-reason {
    color: var(--color-text-tertiary);
    font-size: 0.6875rem;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.changes-chevron) {
      transition: none;
    }

    .change-item--new {
      animation: none;
    }
  }

  @include mobile {
    .changes-section {
      border-radius: var(--radius-md);
    }
  }
</style>
