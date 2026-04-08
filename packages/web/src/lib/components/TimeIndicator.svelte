<script lang="ts">
  import { onMount } from 'svelte';

  let {
    startHour = 0,
    hourHeight = 60,
  }: {
    startHour?: number;
    hourHeight?: number;
  } = $props();

  let now = $state(new Date());

  onMount(() => {
    const interval = setInterval(() => {
      now = new Date();
    }, 60_000);
    return () => clearInterval(interval);
  });

  let hours = $derived(now.getHours() + now.getMinutes() / 60 - startHour);
  let visible = $derived(hours >= 0 && hours <= 24);
  let top = $derived(visible ? hours * hourHeight : 0);
</script>

{#if visible}
  <div class="time-indicator" style:top="{top}px">
    <div class="time-dot"></div>
    <div class="time-line"></div>
  </div>
{/if}

<style lang="scss">
  .time-indicator {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 5;
    pointer-events: none;
    display: flex;
    align-items: center;
  }

  .time-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent);
    flex-shrink: 0;
    margin-left: -3px;
    opacity: 0.8;
  }

  .time-line {
    flex: 1;
    height: 1px;
    background: var(--color-accent);
    opacity: 0.5;
  }
</style>
