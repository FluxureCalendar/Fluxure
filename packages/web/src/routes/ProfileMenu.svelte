<script lang="ts">
  import Settings from 'lucide-svelte/icons/settings';
  import LogOut from 'lucide-svelte/icons/log-out';
  import { onMount } from 'svelte';

  interface Props {
    triggerEl: HTMLButtonElement | undefined;
    onsettings: () => void;
    onlogout: () => void;
    onclose: () => void;
  }

  let { triggerEl, onsettings, onlogout, onclose }: Props = $props();
  let menuEl = $state<HTMLElement | undefined>(undefined);

  onMount(() => {
    const first = menuEl?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }
</script>

<div class="profile-menu-overlay" role="presentation" onkeydown={handleKeydown}>
  <button class="profile-menu-backdrop" onclick={onclose} aria-label="Close menu" tabindex="-1"
  ></button>
  <div
    class="profile-menu"
    role="menu"
    aria-label="Profile menu"
    bind:this={menuEl}
    style="left: {triggerEl?.getBoundingClientRect().left ?? 0}px; bottom: {window.innerHeight -
      (triggerEl?.getBoundingClientRect().top ?? 0) +
      4}px;"
  >
    <button class="profile-menu-item" role="menuitem" onclick={onsettings}>
      <Settings size={16} strokeWidth={1.5} />
      <span>Settings</span>
    </button>
    <div class="profile-menu-divider"></div>
    <button class="profile-menu-item profile-menu-item--danger" role="menuitem" onclick={onlogout}>
      <LogOut size={16} strokeWidth={1.5} />
      <span>Sign out</span>
    </button>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .profile-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: $z-dropdown;
    pointer-events: none;

    > * {
      pointer-events: auto;
    }
  }

  .profile-menu-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .profile-menu {
    position: fixed;
    min-width: 160px;
    width: max-content;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: var(--space-1);
    white-space: nowrap;
  }

  .profile-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-family: inherit;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
    white-space: nowrap;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &--danger:hover {
      color: var(--color-danger);
    }
  }

  .profile-menu-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--space-1) 0;
  }
</style>
