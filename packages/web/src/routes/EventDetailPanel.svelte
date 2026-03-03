<script lang="ts">
  import X from 'lucide-svelte/icons/x';
  import CalendarDays from 'lucide-svelte/icons/calendar-days';
  import Clock from 'lucide-svelte/icons/clock';
  import MapPin from 'lucide-svelte/icons/map-pin';
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Check from 'lucide-svelte/icons/check';
  import Lock from 'lucide-svelte/icons/lock';
  import Unlock from 'lucide-svelte/icons/unlock';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { tick } from 'svelte';
  import type { CalEvent } from './dashboard-utils';

  interface Props {
    event: CalEvent;
    eventTypeMap: Record<string, { bg: string; border: string; label: string }>;
    conflictTitles: string[];
    deleting: boolean;
    onclose: () => void;
    onedit: (event: CalEvent) => void;
    oncomplete: (event: CalEvent) => void;
    ontogglelock: (event: CalEvent) => void;
    ondelete: (event: CalEvent) => void;
    formatFullDate: (iso: string) => string;
    formatTime: (iso: string) => string;
    canEdit: (event: CalEvent) => boolean;
    canComplete: (event: CalEvent) => boolean;
    canLock: (event: CalEvent) => boolean;
    canDelete: (event: CalEvent) => boolean;
    isLocked: (event: CalEvent) => boolean;
  }

  let {
    event,
    eventTypeMap,
    conflictTitles,
    deleting,
    onclose,
    onedit,
    oncomplete,
    ontogglelock,
    ondelete,
    formatFullDate,
    formatTime,
    canEdit,
    canComplete,
    canLock,
    canDelete,
    isLocked,
  }: Props = $props();

  let confirmingDelete = $state(false);
  let confirmBtn: HTMLButtonElement | undefined = $state();

  function requestDelete() {
    confirmingDelete = true;
  }

  function cancelDelete() {
    confirmingDelete = false;
  }

  function handleConfirmDelete() {
    confirmingDelete = false;
    ondelete(event);
  }

  $effect(() => {
    if (confirmingDelete) {
      tick().then(() => confirmBtn?.focus());
    }
  });

  const styles = $derived(eventTypeMap[event.type] || eventTypeMap.external);

  function focusPanel(node: HTMLElement) {
    tick().then(() => {
      const closeBtn = node.querySelector<HTMLElement>('.panel-close-btn');
      closeBtn?.focus();
    });
  }
</script>

<div
  class="panel-backdrop"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
  role="button"
  tabindex="-1"
  aria-label="Close panel"
></div>
<div
  class="panel-slideover"
  role="dialog"
  aria-modal="true"
  aria-labelledby="detail-panel-title"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      onclose();
      return;
    }
    if (e.key === 'Tab') {
      const panel = e.currentTarget as HTMLElement;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }}
  use:focusPanel
>
  <header class="panel-header">
    <div
      class="detail-type-badge"
      style="background: {styles.bg}; color: {styles.border}; border: 1px solid {styles.border};"
    >
      {styles.label}
    </div>
    <button class="panel-close-btn" onclick={onclose} aria-label="Close">
      <X size={16} strokeWidth={1.5} />
    </button>
  </header>

  <div class="panel-body">
    <h2 id="detail-panel-title" class="detail-title">{event.title}</h2>

    <!-- Date & Time -->
    <div class="detail-section">
      <div class="detail-icon-row">
        <CalendarDays size={16} strokeWidth={1.5} class="detail-icon" />
        <span>{formatFullDate(event.startISO)}</span>
      </div>
      <div class="detail-icon-row">
        <Clock size={16} strokeWidth={1.5} class="detail-icon" />
        <span class="font-mono">{formatTime(event.startISO)} – {formatTime(event.endISO)}</span>
        <span class="detail-duration-chip font-mono">{Math.round(event.duration * 60)}m</span>
      </div>
      {#if event.location}
        <div class="detail-icon-row">
          <MapPin size={16} strokeWidth={1.5} class="detail-icon" />
          <span>{event.location}</span>
        </div>
      {/if}
    </div>

    <!-- Details grid -->
    <div class="detail-meta">
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <span class="detail-value">
          <span class="detail-type-dot" style="background: {styles.border};"></span>
          {styles.label}
        </span>
      </div>
      {#if event.status}
        <div class="detail-row">
          <span class="detail-label">Status</span>
          <span class="detail-value detail-status-badge">{event.status}</span>
        </div>
      {/if}
      {#if event.calendarName}
        <div class="detail-row">
          <span class="detail-label">Calendar</span>
          <span class="detail-value">
            {#if event.calendarColor}
              <span class="detail-cal-dot" style="background: {event.calendarColor};"></span>
            {/if}
            {event.calendarName}
          </span>
        </div>
      {/if}
      {#if event.itemId}
        <div class="detail-row">
          <span class="detail-label">Source ID</span>
          <span class="detail-value font-mono" style="font-size: 0.6875rem; opacity: 0.7;"
            >{event.itemId.slice(0, 8)}...</span
          >
        </div>
      {/if}
    </div>

    <!-- Conflicts -->
    {#if conflictTitles.length > 0}
      <div class="detail-conflicts">
        <span class="detail-conflicts-heading">
          <AlertTriangle size={14} strokeWidth={1.5} />
          Conflicts
        </span>
        <ul class="detail-conflicts-list">
          {#each conflictTitles as conflictTitle, conflictIdx (conflictIdx)}
            <li>{conflictTitle}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Actions -->
    {#if canEdit(event) || canComplete(event) || canLock(event) || canDelete(event)}
      <div class="panel-footer detail-actions">
        {#if canEdit(event)}
          <button class="btn-cancel detail-action-full" onclick={() => onedit(event)}>
            <Pencil size={14} strokeWidth={1.5} />
            Edit
          </button>
        {/if}
        {#if canComplete(event)}
          <button
            class="btn-success detail-action-full"
            onclick={() => {
              oncomplete(event);
              onclose();
            }}
          >
            <Check size={14} strokeWidth={1.5} />
            Mark Complete
          </button>
        {/if}
        {#if canLock(event)}
          <button class="btn-cancel detail-action-full" onclick={() => ontogglelock(event)}>
            {#if isLocked(event)}
              <Unlock size={14} strokeWidth={1.5} />
              Unlock
            {:else}
              <Lock size={14} strokeWidth={1.5} />
              Lock
            {/if}
          </button>
        {/if}
        {#if canDelete(event)}
          {#if confirmingDelete}
            <div class="detail-confirm-row">
              <span class="detail-confirm-text">Delete this {styles.label.toLowerCase()}?</span>
              <button
                class="btn-danger detail-action-full"
                bind:this={confirmBtn}
                onclick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Confirm delete'}
              </button>
              <button class="btn-cancel detail-action-full" onclick={cancelDelete}> Cancel </button>
            </div>
          {:else}
            <button
              class="btn-danger detail-action-full"
              onclick={requestDelete}
              disabled={deleting}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              Delete {styles.label}
            </button>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .detail-type-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .detail-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .detail-section {
    @include flex-col(var(--space-2));
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .detail-icon-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);

    :global(.detail-icon) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .detail-duration-chip {
    font-size: 0.6875rem;
    background: var(--color-surface-hover);
    padding: 1px 6px;
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    margin-left: auto;
  }

  .detail-meta {
    @include flex-col(var(--space-3));
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .detail-label {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  .detail-value {
    font-size: 0.8125rem;
    color: var(--color-text);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .detail-type-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .detail-cal-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .detail-status-badge {
    text-transform: capitalize;
  }

  .detail-actions {
    flex-direction: column;
    margin-top: auto;
  }

  .btn-success {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-success);
    background: var(--color-success);
    color: var(--color-accent-text);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity var(--transition-fast);

    &:hover {
      opacity: 0.9;
    }
  }

  .detail-action-full {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }

  .detail-confirm-row {
    @include flex-col(var(--space-2));
  }

  .detail-confirm-text {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-danger);
    text-align: center;
  }

  .detail-conflicts {
    @include flex-col(var(--space-2));
    padding: var(--space-3) var(--space-4);
    background: var(--color-warning-amber-bg);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-warning-amber);

    &-heading {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-warning-amber);
    }

    &-list {
      margin: 0;
      padding-left: var(--space-5);
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      @include flex-col;
      gap: 2px;
    }
  }
</style>
