<script lang="ts">
  let {
    value = $bindable(30),
    min = 5,
    max = 360,
    step = 5,
    label = 'Duration',
  }: {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
  } = $props();

  function fmt(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
</script>

<div class="duration-slider">
  <div class="duration-header">
    <span class="duration-label">{label}</span>
    <span class="duration-value">{fmt(value)}</span>
  </div>
  <input type="range" class="duration-range" {min} {max} {step} bind:value />
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .duration-slider {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .duration-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .duration-label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .duration-value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .duration-range {
    width: 100%;
    height: 4px;
    appearance: none;
    background: var(--color-surface-hover);
    border-radius: 2px;
    outline: none;
    cursor: pointer;

    &::-webkit-slider-thumb {
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--color-accent);
      border: 2px solid var(--color-surface);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
      cursor: pointer;
    }

    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--color-accent);
      border: 2px solid var(--color-surface);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
      cursor: pointer;
    }
  }
</style>
