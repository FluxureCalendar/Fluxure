<script lang="ts">
  import { onMount } from 'svelte';
  import WifiOff from 'lucide-svelte/icons/wifi-off';
  import Loader from 'lucide-svelte/icons/loader';

  let {
    status,
  }: {
    status: string;
  } = $props();

  let showBanner = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Only show banner after status has been non-connected for 3 seconds
  // This prevents the flash of "offline" during initial page load
  $effect(() => {
    if (status === 'connected') {
      showBanner = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    } else if (status !== 'connecting') {
      if (!timer) {
        timer = setTimeout(() => {
          showBanner = true;
          timer = null;
        }, 3000);
      }
    }
  });

  onMount(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  });
</script>

{#if showBanner}
  <div
    class="connection-banner"
    class:banner-danger={status === 'disconnected'}
    class:banner-warning={status === 'reconnecting' || status === 'capacity'}
    role="status"
    aria-live="polite"
  >
    {#if status === 'disconnected'}
      <WifiOff size={14} />
      <span>You're offline</span>
    {:else if status === 'reconnecting'}
      <Loader size={14} class="loading-spinner" />
      <span>Reconnecting...</span>
    {:else}
      <Loader size={14} class="loading-spinner" />
      <span>Connection limited, retrying...</span>
    {/if}
  </div>
{/if}

<style lang="scss">
  .connection-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .banner-danger {
    background: var(--color-danger-muted);
    color: var(--color-danger);
  }

  .banner-warning {
    background: var(--color-warning-muted);
    color: var(--color-warning);
  }
</style>
