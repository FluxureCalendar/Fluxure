<script lang="ts">
  import { getToast, dismissToast } from '$lib/toast.svelte';
  import X from 'lucide-svelte/icons/x';

  const toast = $derived(getToast());
</script>

<div
  class="toast"
  aria-live="polite"
  aria-atomic="true"
  class:toast--visible={!!toast}
  class:toast--error={toast?.type === 'error'}
  class:toast--success={toast?.type === 'success'}
>
  {#if toast}
    <span>{toast.message}</span>
    <button class="toast__dismiss" onclick={dismissToast} aria-label="Dismiss">
      <X size={14} />
    </button>
  {/if}
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .toast {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    font-size: 0.8125rem;
    border: 1px solid var(--color-border);
    z-index: $z-toast;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    display: flex;
    align-items: center;
    gap: var(--space-2);

    &--visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      animation: toast-in var(--transition-slow) ease-out;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }

    &--error {
      color: var(--color-danger);
      border-color: var(--color-danger-muted);
    }

    &--success {
      color: var(--color-success);
      border-color: var(--color-success-muted);
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(0.5rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }

  .toast__dismiss {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    opacity: 0.6;

    &:hover {
      opacity: 1;
    }
  }
</style>
