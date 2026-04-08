<script lang="ts">
  import { fly } from 'svelte/transition';
  import { getToast, dismissToast } from '$lib/toast.svelte';
  import X from 'lucide-svelte/icons/x';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import Info from 'lucide-svelte/icons/info';

  let toast = $derived(getToast());
</script>

{#if toast}
  <div class="toast-container">
    <div
      class="toast"
      class:toast-success={toast.type === 'success'}
      class:toast-error={toast.type === 'error'}
      class:toast-info={toast.type === 'info'}
      role="status"
      aria-live="polite"
      transition:fly={{ y: 16, duration: 200 }}
    >
      <span class="toast-icon">
        {#if toast.type === 'success'}
          <CheckCircle size={16} />
        {:else if toast.type === 'error'}
          <AlertCircle size={16} />
        {:else}
          <Info size={16} />
        {/if}
      </span>
      <span class="toast-message">{toast.message}</span>
      <button class="toast-dismiss" onclick={dismissToast} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .toast-container {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    z-index: $z-toast;

    @include mobile {
      left: var(--space-4);
      right: var(--space-4);
    }
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    font-size: 0.8125rem;
    min-width: 280px;
    max-width: 420px;
  }

  .toast-icon {
    flex-shrink: 0;
    display: flex;
  }

  .toast-success {
    border-color: var(--color-success);

    .toast-icon {
      color: var(--color-success);
    }
  }

  .toast-error {
    border-color: var(--color-danger);

    .toast-icon {
      color: var(--color-danger);
    }
  }

  .toast-info {
    border-color: var(--color-accent);

    .toast-icon {
      color: var(--color-accent);
    }
  }

  .toast-message {
    flex: 1;
    color: var(--color-text);
    line-height: 1.4;
  }

  .toast-dismiss {
    @include icon-btn(20px);
    flex-shrink: 0;
    color: var(--color-text-tertiary);
    transition: color var(--transition-fast);

    &:hover {
      color: var(--color-text);
    }
  }
</style>
