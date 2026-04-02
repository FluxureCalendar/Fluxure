<script lang="ts">
  import Eye from 'lucide-svelte/icons/eye';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Check from 'lucide-svelte/icons/check';
  import Lock from 'lucide-svelte/icons/lock';
  import Unlock from 'lucide-svelte/icons/unlock';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import { tick } from 'svelte';
  import type { CalEvent } from './dashboard-utils';

  interface Props {
    x: number;
    y: number;
    event: CalEvent;
    eventTypeMap: Record<string, { bg: string; border: string; label: string }>;
    onclose: () => void;
    onviewdetails: (event: CalEvent) => void;
    onedit: (event: CalEvent) => void;
    oncomplete: (event: CalEvent) => void;
    ontogglelock: (event: CalEvent) => void;
    onmove: (event: CalEvent, deltaMinutes: number) => void;
    ondelete: (event: CalEvent) => void;
    formatTime: (iso: string) => string;
    canEdit: (event: CalEvent) => boolean;
    canComplete: (event: CalEvent) => boolean;
    canLock: (event: CalEvent) => boolean;
    canDrag: (event: CalEvent) => boolean;
    canDelete: (event: CalEvent) => boolean;
    isLocked: (event: CalEvent) => boolean;
  }

  let {
    x,
    y,
    event,
    eventTypeMap,
    onclose,
    onviewdetails,
    onedit,
    oncomplete,
    ontogglelock,
    onmove,
    ondelete,
    formatTime,
    canEdit,
    canComplete,
    canLock,
    canDrag,
    canDelete,
    isLocked,
  }: Props = $props();

  const styles = $derived(eventTypeMap[event.type] || eventTypeMap.external);

  let menuEl = $state<HTMLElement | undefined>(undefined);

  // Focus the menu container (not a specific item) so keyboard nav works
  // without showing a focus ring on the first item
  $effect(() => {
    if (menuEl) {
      tick().then(() => menuEl?.focus());
    }
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
/>
<div
  class="ctx-menu"
  role="menu"
  tabindex="-1"
  aria-label="Event actions for {event.title}"
  bind:this={menuEl}
  style="left: {Math.min(x, window.innerWidth - 200)}px; top: {Math.min(
    y,
    window.innerHeight - 280,
  )}px;"
  onclick={(e) => e.stopPropagation()}
  oncontextmenu={(e) => e.stopPropagation()}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      onclose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      );
      const current = Array.from(items).indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'ArrowDown'
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }}
>
  <button class="ctx-item" role="menuitem" onclick={() => onviewdetails(event)}>
    <Eye size={14} strokeWidth={1.5} />
    View details
  </button>
  {#if canEdit(event)}
    <button class="ctx-item" role="menuitem" onclick={() => onedit(event)}>
      <Pencil size={14} strokeWidth={1.5} />
      Edit
    </button>
  {/if}
  {#if canComplete(event)}
    <button
      class="ctx-item ctx-item--success"
      role="menuitem"
      onclick={() => {
        oncomplete(event);
        onclose();
      }}
    >
      <Check size={14} strokeWidth={1.5} />
      Mark complete
    </button>
  {/if}
  {#if canLock(event)}
    <button class="ctx-item" role="menuitem" onclick={() => ontogglelock(event)}>
      {#if isLocked(event)}
        <Unlock size={14} strokeWidth={1.5} />
        Unlock
      {:else}
        <Lock size={14} strokeWidth={1.5} />
        Lock
      {/if}
    </button>
  {/if}
  {#if canDrag(event)}
    <button class="ctx-item" role="menuitem" onclick={() => onmove(event, -15)}>
      <ChevronLeft size={14} strokeWidth={1.5} />
      Move earlier (15 min)
    </button>
    <button class="ctx-item" role="menuitem" onclick={() => onmove(event, 15)}>
      <ChevronRight size={14} strokeWidth={1.5} />
      Move later (15 min)
    </button>
  {/if}
  {#if canDelete(event)}
    <button class="ctx-item ctx-item--danger" role="menuitem" onclick={() => ondelete(event)}>
      <Trash2 size={14} strokeWidth={1.5} />
      Delete {styles.label.toLowerCase()}
    </button>
  {/if}
  <div class="ctx-divider"></div>
  <div class="ctx-info">
    <span class="ctx-info-label">{event.title}</span>
    <span class="ctx-info-sub font-mono"
      >{formatTime(event.startISO)} – {formatTime(event.endISO)}</span
    >
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .ctx-menu {
    @include dropdown;
    position: fixed;
    z-index: 60;
    min-width: 180px;
    animation: fadeIn 100ms ease;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  .ctx-item {
    @include menu-item;
    color: var(--color-text);

    &--danger {
      @include menu-item-danger;
      color: var(--color-danger);
    }

    &--success {
      color: var(--color-success);

      &:hover {
        background: color-mix(in srgb, var(--color-success) 10%, transparent);
      }
    }
  }

  .ctx-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--space-1) 0;
  }

  .ctx-info {
    padding: var(--space-2) var(--space-3);
    @include flex-col;
    gap: 2px;

    &-label {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      font-weight: 500;
    }

    &-sub {
      font-size: 0.6875rem;
      color: var(--color-text-tertiary);
    }
  }
</style>
