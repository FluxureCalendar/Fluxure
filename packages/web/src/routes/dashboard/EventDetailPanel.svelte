<script lang="ts">
  import { fly, fade } from 'svelte/transition';
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
    isCompleted: (event: CalEvent) => boolean;
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
    isCompleted,
    canLock,
    canDelete,
    isLocked,
  }: Props = $props();

  let confirmingDelete = $state(false);

  const styles = $derived(eventTypeMap[event.type] || eventTypeMap.external);
  const durationMins = $derived(Math.round(event.duration * 60));
  const durationLabel = $derived(
    durationMins >= 60
      ? `${Math.floor(durationMins / 60)}h${durationMins % 60 ? ` ${durationMins % 60}m` : ''}`
      : `${durationMins}m`,
  );
</script>

<div
  class="detail-overlay"
  role="presentation"
  onclick={onclose}
  transition:fade={{ duration: 120 }}
>
  <div
    class="detail-card"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-labelledby="detail-title"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') onclose();
    }}
    transition:fly={{ y: 12, duration: 180 }}
  >
    <!-- Top color bar -->
    <div class="detail-accent" style="background: {styles.border};"></div>

    <!-- Header -->
    <div class="detail-header">
      <div class="detail-header-left">
        <span class="detail-type" style="color: {styles.border};">{styles.label}</span>
        <h2 id="detail-title" class="detail-title">{event.title}</h2>
      </div>
      <button class="detail-close" onclick={onclose} aria-label="Close">
        <X size={16} />
      </button>
    </div>

    <!-- Info -->
    <div class="detail-info">
      <div class="detail-row">
        <CalendarDays size={14} />
        <span>{formatFullDate(event.startISO)}</span>
      </div>
      <div class="detail-row">
        <Clock size={14} />
        <span>{formatTime(event.startISO)} – {formatTime(event.endISO)}</span>
        <span class="detail-chip">{durationLabel}</span>
      </div>
      {#if event.location}
        <div class="detail-row">
          <MapPin size={14} />
          <span>{event.location}</span>
        </div>
      {/if}
    </div>

    <!-- Meta -->
    {#if event.status || event.calendarName}
      <div class="detail-meta">
        {#if event.status}
          <div class="detail-meta-item">
            <span class="detail-meta-label">Status</span>
            <span class="detail-meta-value">{event.status}</span>
          </div>
        {/if}
        {#if event.calendarName}
          <div class="detail-meta-item">
            <span class="detail-meta-label">Calendar</span>
            <span class="detail-meta-value">
              {#if event.calendarColor}
                <span class="detail-dot" style="background: {event.calendarColor};"></span>
              {/if}
              {event.calendarName}
            </span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Conflicts -->
    {#if conflictTitles.length > 0}
      <div class="detail-conflicts">
        <AlertTriangle size={14} />
        <span
          >{conflictTitles.length} conflict{conflictTitles.length > 1 ? 's' : ''}: {conflictTitles.join(
            ', ',
          )}</span
        >
      </div>
    {/if}

    <!-- Actions -->
    {#if canEdit(event) || canComplete(event) || canLock(event) || canDelete(event)}
      <div class="detail-actions">
        {#if canEdit(event)}
          <button class="action-btn" onclick={() => onedit(event)}>
            <Pencil size={14} />
            Edit
          </button>
        {/if}
        {#if canComplete(event)}
          <button
            class="action-btn {isCompleted(event) ? '' : 'action-success'}"
            onclick={() => {
              oncomplete(event);
              onclose();
            }}
          >
            <Check size={14} />
            {isCompleted(event) ? 'Undo complete' : 'Complete'}
          </button>
        {/if}
        {#if canLock(event)}
          <button class="action-btn" onclick={() => ontogglelock(event)}>
            {#if isLocked(event)}
              <Unlock size={14} />
              Unlock
            {:else}
              <Lock size={14} />
              Lock
            {/if}
          </button>
        {/if}
        {#if canDelete(event)}
          {#if confirmingDelete}
            <button
              class="action-btn action-danger"
              onclick={() => {
                confirmingDelete = false;
                ondelete(event);
              }}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Confirm delete'}
            </button>
            <button class="action-btn" onclick={() => (confirmingDelete = false)}>Cancel</button>
          {:else}
            <button
              class="action-btn action-danger-outline"
              onclick={() => (confirmingDelete = true)}
              disabled={deleting}
            >
              <Trash2 size={14} />
              Delete
            </button>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .detail-overlay {
    position: fixed;
    inset: 0;
    z-index: $z-modal;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-overlay);
    backdrop-filter: blur(2px);
    padding: var(--space-4);
  }

  .detail-card {
    width: 100%;
    max-width: 420px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .detail-accent {
    height: 3px;
    width: 100%;
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: var(--space-5) var(--space-5) 0;
    gap: var(--space-3);
  }

  .detail-header-left {
    @include flex-col(var(--space-1));
    min-width: 0;
  }

  .detail-type {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .detail-title {
    font-family: $font-body;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
    line-height: 1.3;
  }

  .detail-close {
    @include icon-btn(28px);
    flex-shrink: 0;
    color: var(--color-text-tertiary);
  }

  .detail-info {
    @include flex-col(var(--space-2));
    padding: var(--space-4) var(--space-5);
  }

  .detail-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);

    :global(svg) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .detail-chip {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    background: var(--color-surface-hover);
    padding: 1px 6px;
    border-radius: var(--radius-full);
  }

  .detail-meta {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--color-separator);
    border-bottom: 1px solid var(--color-separator);
  }

  .detail-meta-item {
    @include flex-col(2px);
  }

  .detail-meta-label {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .detail-meta-value {
    font-size: 0.8125rem;
    color: var(--color-text);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    text-transform: capitalize;
  }

  .detail-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .detail-conflicts {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0 var(--space-5);
    padding: var(--space-3);
    background: var(--color-warning-amber-bg);
    border: 1px solid var(--color-warning-amber);
    border-radius: var(--radius-md);
    font-size: 0.75rem;
    color: var(--color-warning-amber);
    line-height: 1.4;

    :global(svg) {
      flex-shrink: 0;
      margin-top: 1px;
    }
  }

  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-5) var(--space-5);
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font-family: $font-body;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
    @include press-feedback;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &:disabled {
      opacity: var(--opacity-disabled);
      cursor: not-allowed;
    }
  }

  .action-success {
    border-color: var(--color-success);
    color: var(--color-success);

    &:hover {
      background: var(--color-success);
      color: var(--color-accent-text);
    }
  }

  .action-danger-outline {
    color: var(--color-text-tertiary);

    &:hover {
      border-color: var(--color-danger);
      color: var(--color-danger);
      background: var(--color-danger-muted);
    }
  }

  .action-danger {
    border-color: var(--color-danger);
    background: var(--color-danger);
    color: var(--color-accent-text);

    &:hover {
      opacity: 0.9;
    }
  }
</style>
