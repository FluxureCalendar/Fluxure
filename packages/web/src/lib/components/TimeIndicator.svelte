<script lang="ts">
  import { TIME_TICK_INTERVAL_MS } from '@fluxure/shared';

  let { getPosition }: { getPosition: () => number } = $props();

  // Isolated tick — only this component re-renders every 60s
  let timeTick = $state(0);

  $effect(() => {
    const interval = setInterval(() => {
      timeTick++;
    }, TIME_TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  });

  let position = $derived.by(() => {
    void timeTick;
    return getPosition();
  });
</script>

{#if position >= 0}
  <div class="current-time-line" style="top: {position}px;">
    <div class="current-time-dot"></div>
  </div>
{/if}

<style lang="scss">
  .current-time-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 2px solid var(--color-accent);
    z-index: 20;
    pointer-events: none;
  }

  .current-time-dot {
    position: absolute;
    left: -4px;
    top: -5px;
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
  }
</style>
