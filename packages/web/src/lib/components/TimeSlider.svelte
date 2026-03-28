<script lang="ts">
  let {
    value = $bindable('09:00'),
    label = 'Time',
    step = 30,
    min = 0,
    max = 1410,
  }: {
    value: string;
    label?: string;
    step?: number;
    min?: number;
    max?: number;
  } = $props();

  function timeToMins(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function minsToTime(mins: number): string {
    const c = Math.max(0, Math.min(1410, mins));
    return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
  }

  function fmtAmPm(t: string): string {
    const mins = timeToMins(t);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h >= 12 ? 'PM' : 'AM';
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }
</script>

<div class="time-slider">
  <div class="time-header">
    <span class="time-label">{label}</span>
    <span class="time-value">{fmtAmPm(value)}</span>
  </div>
  <input
    type="range"
    class="time-range"
    {min}
    {max}
    {step}
    value={timeToMins(value)}
    oninput={(e) => {
      value = minsToTime(parseInt((e.target as HTMLInputElement).value));
    }}
  />
  <div class="time-labels">
    <span>{fmtAmPm(minsToTime(min))}</span>
    <span>{fmtAmPm(minsToTime(max))}</span>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;

  .time-slider {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .time-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .time-label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .time-value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .time-range {
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

  .time-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.5625rem;
    color: var(--color-text-tertiary);
  }
</style>
