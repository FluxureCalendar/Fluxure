<script lang="ts">
  let {
    start = $bindable('09:00'),
    end = $bindable('17:00'),
    color = 'accent',
  }: {
    start: string;
    end: string;
    color?: 'accent' | 'success';
  } = $props();

  function timeToMins(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function minsToTime(mins: number): string {
    const clamped = Math.max(0, mins >= 1440 ? 1439 : mins);
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  }

  function timeToPercent(t: string): number {
    const mins = timeToMins(t);
    if (mins >= 1439) return 100;
    return (mins / 1440) * 100;
  }

  function formatTimeLabel(t: string): string {
    const mins = timeToMins(t);
    if (mins >= 1439) return '12 AM';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h >= 12 ? 'PM' : 'AM';
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  function hoursBetween(s: string, e: string): string {
    let endMins = timeToMins(e);
    if (endMins === 1439) endMins = 1440;
    const diff = endMins - timeToMins(s);
    if (diff <= 0) return '0h';
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function snapToSlot(mins: number): number {
    return Math.round(mins / 30) * 30;
  }

  let dragging: {
    mode: 'start' | 'end' | 'slide';
    trackEl: HTMLElement;
    slideOffset: number;
  } | null = $state(null);

  function handleThumbDown(e: PointerEvent, mode: 'start' | 'end') {
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).parentElement!;
    dragging = { mode, trackEl: track, slideOffset: 0 };
    track.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging-range');
  }

  function handleFillDown(e: PointerEvent) {
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).parentElement!;
    const rect = track.getBoundingClientRect();
    const clickMins = ((e.clientX - rect.left) / rect.width) * 1440;
    dragging = { mode: 'slide', trackEl: track, slideOffset: clickMins - timeToMins(start) };
    track.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging-range');
  }

  function handleRangeMove(e: PointerEvent) {
    if (!dragging) return;
    const rect = dragging.trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const rawMins = pct * 1440;
    const curStart = timeToMins(start);
    const rawEnd = timeToMins(end);
    const curEnd = rawEnd === 1439 ? 1440 : rawEnd;
    const duration = curEnd - curStart;

    if (dragging.mode === 'start') {
      const snapped = Math.max(0, Math.min(curEnd - 30, snapToSlot(rawMins)));
      start = minsToTime(snapped);
    } else if (dragging.mode === 'end') {
      const snapped = Math.max(curStart + 30, Math.min(1440, snapToSlot(rawMins)));
      end = minsToTime(snapped);
    } else {
      const newStart = snapToSlot(rawMins - dragging.slideOffset);
      const maxStart = duration >= 1410 ? 0 : 1440 - duration;
      const clamped = Math.max(0, Math.min(maxStart, newStart));
      start = minsToTime(clamped);
      end = minsToTime(clamped + duration);
    }
  }

  function handleRangeUp() {
    dragging = null;
    document.body.classList.remove('dragging-range');
  }

  function handleHandleKeydown(e: KeyboardEvent, mode: 'start' | 'end') {
    const step = 30;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (mode === 'start') {
        const newMins = Math.max(0, timeToMins(start) - step);
        start = minsToTime(snapToSlot(newMins));
      } else {
        const newMins = Math.max(timeToMins(start) + step, timeToMins(end) - step);
        end = minsToTime(snapToSlot(newMins));
      }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (mode === 'start') {
        const newMins = Math.min(timeToMins(end) - step, timeToMins(start) + step);
        start = minsToTime(snapToSlot(newMins));
      } else {
        const newMins = Math.min(1440, timeToMins(end) + step);
        end = minsToTime(snapToSlot(newMins));
      }
    }
  }
</script>

<svelte:window onpointermove={handleRangeMove} onpointerup={handleRangeUp} />

<div class="time-range" class:time-range--success={color === 'success'}>
  <div class="range-track">
    <div
      class="range-fill"
      role="presentation"
      style="left: {timeToPercent(start)}%; width: {timeToPercent(end) - timeToPercent(start)}%"
      onpointerdown={handleFillDown}
    >
      <span class="range-duration">{hoursBetween(start, end)}</span>
    </div>
    <div
      class="range-handle"
      role="slider"
      tabindex="0"
      aria-label="Start time"
      aria-valuemin={0}
      aria-valuemax={timeToMins(end) - 30}
      aria-valuenow={timeToMins(start)}
      aria-valuetext={formatTimeLabel(start)}
      style="left: {timeToPercent(start)}%"
      onpointerdown={(e) => handleThumbDown(e, 'start')}
      onkeydown={(e) => handleHandleKeydown(e, 'start')}
    >
      <span class="range-time-label">{formatTimeLabel(start)}</span>
    </div>
    <div
      class="range-handle"
      role="slider"
      tabindex="0"
      aria-label="End time"
      aria-valuemin={timeToMins(start) + 30}
      aria-valuemax={1440}
      aria-valuenow={timeToMins(end)}
      aria-valuetext={formatTimeLabel(end)}
      style="left: {timeToPercent(end)}%"
      onpointerdown={(e) => handleThumbDown(e, 'end')}
      onkeydown={(e) => handleHandleKeydown(e, 'end')}
    >
      <span class="range-time-label">{formatTimeLabel(end)}</span>
    </div>
  </div>
  <div class="range-labels">
    <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  :global(body.dragging-range),
  :global(body.dragging-range *) {
    cursor: grabbing !important;
  }

  .time-range {
    @include flex-col(var(--space-1));
    user-select: none;
    padding-top: var(--space-6);
    --range-color: var(--color-accent);
    --range-muted: var(--color-accent-muted);
  }

  .time-range--success {
    --range-color: var(--color-success);
    --range-muted: var(--color-success-muted);
  }

  .range-track {
    position: relative;
    height: 32px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-md);
    touch-action: none;
  }

  .range-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: var(--radius-md);
    background: var(--range-muted);
    border: 1px solid var(--range-color);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }

  .range-duration {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--range-color);
    white-space: nowrap;
    pointer-events: none;
  }

  .range-handle {
    position: absolute;
    top: 50%;
    width: 18px;
    height: 18px;
    transform: translate(-50%, -50%);
    cursor: ew-resize;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;

    &::after {
      content: '';
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 2px solid var(--range-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      transition: transform var(--transition-fast);
    }

    &:hover::after {
      transform: scale(1.2);
    }
  }

  .range-time-label {
    position: absolute;
    bottom: calc(100% + 10px);
    font-size: 0.5625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    white-space: nowrap;
    pointer-events: none;
  }

  .range-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.5625rem;
    color: var(--color-text-tertiary);
    padding: 0 1px;
  }
</style>
