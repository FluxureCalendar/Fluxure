<script lang="ts">
  import AlertTriangle from 'lucide-svelte/icons/triangle-alert';
  import Check from 'lucide-svelte/icons/check';
  import TimeIndicator from '$lib/components/TimeIndicator.svelte';
  import { SvelteDate, SvelteMap } from 'svelte/reactivity';
  import {
    HOUR_HEIGHT_PX,
    DRAG_THRESHOLD_PX,
    RESIZE_EDGE_PX,
    MIN_EVENT_DURATION_HOURS,
    addMinutes,
  } from '@fluxure/shared';
  import type { CalEvent } from './dashboard-utils';

  interface Props {
    events: CalEvent[];
    weekDates: SvelteDate[];
    loading: boolean;
    dayNames: string[];
    eventTypeMap: Record<string, { bg: string; border: string; label: string }>;
    userTimezone: string;
    isToday: (date: Date) => boolean;
    getCurrentTimePosition: () => number;
    getTodayDayIndex: () => number;
    isEventPast: (event: CalEvent) => boolean;
    canDrag: (event: CalEvent) => boolean;
    canComplete: (event: CalEvent) => boolean;
    oneventclick: (event: CalEvent) => void;
    oneventcontextmenu: (e: MouseEvent, event: CalEvent) => void;
    oncomplete: (event: CalEvent) => void;
    onmove: (eventId: string, newStartISO: string, newEndISO: string, isExternal: boolean) => void;
    onresize: (
      eventId: string,
      newStartISO: string,
      newEndISO: string,
      isExternal: boolean,
    ) => void;
    onhabitresize: (event: CalEvent, newStart: string, newEnd: string, durationMin: number) => void;
    onscrollcontainer?: (el: HTMLDivElement) => void;
    midnightInTz: (year: number, month: number, day: number) => number;
  }

  let {
    events,
    weekDates,
    loading,
    dayNames,
    eventTypeMap,
    isToday,
    getCurrentTimePosition,
    getTodayDayIndex,
    isEventPast,
    canDrag,
    canComplete,
    oneventclick,
    oneventcontextmenu,
    oncomplete,
    onmove,
    onresize,
    onhabitresize,
    onscrollcontainer,
    midnightInTz,
  }: Props = $props();

  const START_HOUR = 0;
  const END_HOUR = 24;
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR);
  const HOUR_HEIGHT = HOUR_HEIGHT_PX;
  const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  let hasAnyAllDay = $derived(events.some((e) => e.isAllDay));

  function detectConflicts(evts: CalEvent[]): SvelteMap<string, string[]> {
    const conflicts = new SvelteMap<string, string[]>();
    const timedEvents = evts.filter((e) => !e.isAllDay);
    // Sort by dayIndex first, then startHour for sweep-line
    const sorted = [...timedEvents].sort(
      (a, b) => a.dayIndex - b.dayIndex || a.startHour - b.startHour,
    );
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const aEnd = a.startHour + a.duration;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.dayIndex !== a.dayIndex) break; // Different day, no more overlaps
        if (b.startHour >= aEnd) break; // Sorted: no more overlaps possible
        const aId = a.id || a.title;
        const bId = b.id || b.title;
        if (!conflicts.has(aId)) conflicts.set(aId, []);
        if (!conflicts.has(bId)) conflicts.set(bId, []);
        conflicts.get(aId)!.push(b.title);
        conflicts.get(bId)!.push(a.title);
      }
    }
    return conflicts;
  }

  let conflicts = $derived(detectConflicts(events));

  interface LayoutEvent extends CalEvent {
    col: number;
    totalCols: number;
  }

  function getAllDayEventsForDay(dayIndex: number): CalEvent[] {
    return events.filter((e) => e.dayIndex === dayIndex && e.isAllDay);
  }

  function getEventsForDay(dayIndex: number): LayoutEvent[] {
    const dayEvents = events
      .filter((e) => e.dayIndex === dayIndex && !e.isAllDay)
      .sort((a, b) => a.startHour - b.startHour || b.duration - a.duration);

    const columns: { startHour: number; duration: number; idx: number }[][] = [];
    const layout: { col: number }[] = [];

    for (let i = 0; i < dayEvents.length; i++) {
      const ev = dayEvents[i];
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const hasOverlap = columns[c].some(
          (o) =>
            ev.startHour < o.startHour + o.duration && ev.startHour + ev.duration > o.startHour,
        );
        if (!hasOverlap) {
          columns[c].push({ startHour: ev.startHour, duration: ev.duration, idx: i });
          layout[i] = { col: c };
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([{ startHour: ev.startHour, duration: ev.duration, idx: i }]);
        layout[i] = { col: columns.length - 1 };
      }
    }

    // Compute totalCols for each event's overlap group in a forward sweep
    // For each event, find all overlapping events and take the max column + 1
    const totalColsArr: number[] = new Array(dayEvents.length).fill(1);
    for (let i = 0; i < dayEvents.length; i++) {
      const ev = dayEvents[i];
      const evEnd = ev.startHour + ev.duration;
      let maxCol = layout[i].col;
      for (let j = i + 1; j < dayEvents.length; j++) {
        if (dayEvents[j].startHour >= evEnd) break; // sorted by startHour
        maxCol = Math.max(maxCol, layout[j].col);
      }
      // Also check earlier events that overlap with this one
      for (let j = i - 1; j >= 0; j--) {
        if (dayEvents[j].startHour + dayEvents[j].duration <= ev.startHour) break;
        maxCol = Math.max(maxCol, layout[j].col);
      }
      totalColsArr[i] = maxCol + 1;
    }

    // Normalize: all events in the same overlap group should share the same totalCols
    for (let i = 0; i < dayEvents.length; i++) {
      const ev = dayEvents[i];
      const evEnd = ev.startHour + ev.duration;
      for (let j = i + 1; j < dayEvents.length; j++) {
        if (dayEvents[j].startHour >= evEnd) break;
        const shared = Math.max(totalColsArr[i], totalColsArr[j]);
        totalColsArr[i] = shared;
        totalColsArr[j] = shared;
      }
    }

    return dayEvents.map((ev, i) => ({
      ...ev,
      col: layout[i].col,
      totalCols: totalColsArr[i],
    }));
  }

  let layoutByDay = $derived(Array.from({ length: 7 }, (_, i) => getEventsForDay(i)));
  let allDayByDay = $derived(Array.from({ length: 7 }, (_, i) => getAllDayEventsForDay(i)));

  function formatHourLabel(hour: number): string {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  }

  function formatStartTime(startHour: number): string {
    const h = Math.floor(startHour);
    const m = Math.round((startHour - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  function formatEndTime(startHour: number, duration: number): string {
    const endDecimal = startHour + duration;
    const endH = Math.floor(endDecimal);
    const endM = Math.round((endDecimal - endH) * 60);
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  }

  function formatHourAmPm(startHour: number): string {
    const h = Math.floor(startHour);
    const m = Math.round((startHour - h) * 60);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;
  }

  const DRAG_THRESHOLD = DRAG_THRESHOLD_PX;
  const RESIZE_EDGE = RESIZE_EDGE_PX;
  const MIN_DURATION = MIN_EVENT_DURATION_HOURS;

  let dragState = $state<{
    event: CalEvent;
    offsetY: number;
    currentDayIndex: number;
    currentStartHour: number;
    originalDayIndex: number;
    originalStartHour: number;
  } | null>(null);

  let pendingPointer = $state<{
    event: CalEvent;
    startX: number;
    startY: number;
    pointerId: number;
    target: HTMLElement;
    mode: 'move' | 'resize-top' | 'resize-bottom';
    offsetY: number;
  } | null>(null);

  let resizeState = $state<{
    event: CalEvent;
    edge: 'top' | 'bottom';
    originalStartHour: number;
    originalDuration: number;
    currentStartHour: number;
    currentDuration: number;
  } | null>(null);

  let justDragged = $state(false);

  let timeGridEl: HTMLDivElement | undefined = $state();
  let scrollContainer: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (scrollContainer && onscrollcontainer) {
      onscrollcontainer(scrollContainer);
    }
  });

  function getPointerMode(
    e: PointerEvent,
    target: HTMLElement,
  ): 'move' | 'resize-top' | 'resize-bottom' {
    const rect = target.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y <= RESIZE_EDGE && rect.height > 24) return 'resize-top';
    if (rect.height - y <= RESIZE_EDGE && rect.height > 24) return 'resize-bottom';
    return 'move';
  }

  function handleDragStart(e: PointerEvent, event: CalEvent) {
    if (!canDrag(event)) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const rect = target.getBoundingClientRect();
    const mode = getPointerMode(e, target);

    pendingPointer = {
      event,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      target,
      mode,
      offsetY: e.clientY - rect.top,
    };
  }

  function handleDragMove(e: PointerEvent) {
    if (pendingPointer) {
      const dx = e.clientX - pendingPointer.startX;
      const dy = e.clientY - pendingPointer.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

      const { event, mode, offsetY } = pendingPointer;
      if (mode === 'move') {
        dragState = {
          event,
          offsetY,
          currentDayIndex: event.dayIndex,
          currentStartHour: event.startHour,
          originalDayIndex: event.dayIndex,
          originalStartHour: event.startHour,
        };
      } else {
        resizeState = {
          event,
          edge: mode === 'resize-top' ? 'top' : 'bottom',
          originalStartHour: event.startHour,
          originalDuration: event.duration,
          currentStartHour: event.startHour,
          currentDuration: event.duration,
        };
      }
      pendingPointer = null;
    }

    if (dragState && timeGridEl) {
      e.preventDefault();
      const gridRect = timeGridEl.getBoundingClientRect();
      const y = e.clientY - gridRect.top - dragState.offsetY;
      const x = e.clientX - gridRect.left;

      const timeColWidth = 56;
      const colX = x - timeColWidth;
      const dayColWidth = (gridRect.width - timeColWidth) / 7;
      const dayIndex = Math.max(0, Math.min(6, Math.floor(colX / dayColWidth)));

      const rawHour = START_HOUR + y / HOUR_HEIGHT;
      const snappedHour = Math.round(rawHour * 4) / 4;
      const clampedHour = Math.max(
        START_HOUR,
        Math.min(END_HOUR - dragState.event.duration, snappedHour),
      );

      dragState = { ...dragState, currentDayIndex: dayIndex, currentStartHour: clampedHour };
      return;
    }

    if (resizeState && timeGridEl) {
      e.preventDefault();
      const gridRect = timeGridEl.getBoundingClientRect();
      const mouseHourRaw = START_HOUR + (e.clientY - gridRect.top) / HOUR_HEIGHT;
      const mouseHour = Math.round(mouseHourRaw * 4) / 4;

      if (resizeState.edge === 'bottom') {
        const newDuration = Math.max(MIN_DURATION, mouseHour - resizeState.originalStartHour);
        const clampedDuration = Math.min(END_HOUR - resizeState.originalStartHour, newDuration);
        resizeState = { ...resizeState, currentDuration: clampedDuration };
      } else {
        const endHour = resizeState.originalStartHour + resizeState.originalDuration;
        const clampedStart = Math.max(START_HOUR, Math.min(endHour - MIN_DURATION, mouseHour));
        resizeState = {
          ...resizeState,
          currentStartHour: clampedStart,
          currentDuration: endHour - clampedStart,
        };
      }
    }
  }

  async function handleDragEnd(e: PointerEvent) {
    (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);

    if (pendingPointer) {
      pendingPointer = null;
      return;
    }

    // Handle resize end
    if (resizeState) {
      const { event, currentStartHour, currentDuration, originalStartHour, originalDuration } =
        resizeState;
      resizeState = null;

      if (
        Math.abs(currentStartHour - originalStartHour) < 0.01 &&
        Math.abs(currentDuration - originalDuration) < 0.01
      ) {
        return;
      }

      justDragged = true;
      requestAnimationFrame(() => {
        justDragged = false;
      });

      if (!event.id) return;

      const day = weekDates[event.dayIndex];
      const dayMidnight = new Date(midnightInTz(day.getFullYear(), day.getMonth(), day.getDate()));
      const newStart = addMinutes(dayMidnight, Math.round(currentStartHour * 60)).toISOString();
      const newEnd = addMinutes(
        dayMidnight,
        Math.round((currentStartHour + currentDuration) * 60),
      ).toISOString();
      const newDurationMin = Math.round(currentDuration * 60);

      // If habit and duration changed, ask user
      if (event.type === 'habit' && Math.abs(currentDuration - originalDuration) >= 0.01) {
        onhabitresize(event, newStart, newEnd, newDurationMin);
        return;
      }

      onresize(event.id, newStart, newEnd, event.type === 'external');
      return;
    }

    // Handle drag end
    if (!dragState) return;

    const { event, currentDayIndex, currentStartHour, originalDayIndex, originalStartHour } =
      dragState;
    dragState = null;

    if (
      currentDayIndex === originalDayIndex &&
      Math.abs(currentStartHour - originalStartHour) < 0.25
    ) {
      return;
    }

    justDragged = true;
    requestAnimationFrame(() => {
      justDragged = false;
    });

    if (!event.id) return;

    const day = weekDates[currentDayIndex];
    const dayMidnight = new Date(midnightInTz(day.getFullYear(), day.getMonth(), day.getDate()));
    const newStart = addMinutes(dayMidnight, Math.round(currentStartHour * 60)).toISOString();
    const newEnd = addMinutes(
      dayMidnight,
      Math.round((currentStartHour + event.duration) * 60),
    ).toISOString();

    onmove(event.id, newStart, newEnd, event.type === 'external');
  }
</script>

{#if loading}
  <div class="loading-skeleton" aria-busy="true" aria-label="Loading schedule">
    <div class="skeleton-header">
      {#each Array(7) as _, i (i)}
        <div class="skeleton-day-col">
          <div class="skeleton-pulse skeleton-day-label"></div>
        </div>
      {/each}
    </div>
    <div class="skeleton-grid">
      {#each Array(7) as _, i (i)}
        <div class="skeleton-day-col">
          <div class="skeleton-pulse skeleton-block" style="height: 48px; margin-top: 40px;"></div>
          <div class="skeleton-pulse skeleton-block" style="height: 72px; margin-top: 24px;"></div>
          <div class="skeleton-pulse skeleton-block" style="height: 36px; margin-top: 48px;"></div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <!-- Calendar Grid -->
  <div class="calendar-container">
    <!-- Day Headers -->
    <div class="day-headers">
      <div class="time-col-header"></div>
      {#each weekDates as date, i (i)}
        <div class="day-header" class:day-header--today={isToday(date)}>
          <span class="day-header-name">{dayNames[i]}</span>
          <span class="day-header-date font-mono" class:day-header-date--today={isToday(date)}>
            {date.getDate()}
            {#if isToday(date)}
              <span class="today-dot"></span>
            {/if}
          </span>
        </div>
      {/each}
    </div>

    <!-- All-day events row -->
    {#if hasAnyAllDay}
      <div class="all-day-row">
        <div class="time-col-header all-day-label font-mono">All day</div>
        {#each Array(7) as _, dayIdx (dayIdx)}
          <div class="all-day-cell">
            {#each allDayByDay[dayIdx] as event (event.id || event.title)}
              {@const styles = eventTypeMap[event.type] || eventTypeMap.external}
              <button
                class="all-day-event"
                class:all-day-event--past={isEventPast(event)}
                style="background: {event.itemColor
                  ? event.itemColor + '22'
                  : styles.bg}; border-left: 3px solid {event.itemColor || styles.border};"
                onclick={() => oneventclick(event)}
                aria-label="{event.title} (all day)"
              >
                <span class="all-day-event-title">{event.title}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Scrollable time grid -->
    <div class="time-grid-scroll" bind:this={scrollContainer}>
      <div
        class="time-grid"
        class:time-grid--dragging={!!dragState}
        style="height: {GRID_HEIGHT}px;"
        bind:this={timeGridEl}
      >
        <!-- Time Labels Column -->
        <div class="time-labels-col">
          {#each hours as hour, idx (idx)}
            <div
              class="time-label font-mono"
              style="top: {idx * HOUR_HEIGHT}px;"
              aria-hidden="true"
            >
              {formatHourLabel(hour)}
            </div>
          {/each}
        </div>

        <!-- Shared hour grid lines -->
        <div class="hour-lines-overlay" aria-hidden="true">
          {#each hours as _, hourIdx (hourIdx)}
            <div class="hour-line" style="top: {hourIdx * HOUR_HEIGHT}px;"></div>
          {/each}
        </div>

        <!-- Day Columns -->
        {#each Array(7) as _, dayIdx (dayIdx)}
          {@const todayIdx = getTodayDayIndex()}
          <div class="day-col" class:day-col--today={dayIdx === todayIdx}>
            {#if dayIdx === todayIdx}
              <TimeIndicator getPosition={getCurrentTimePosition} />
            {/if}

            {#each layoutByDay[dayIdx] as event (event.id || event.title)}
              {@const colWidth = 100 / event.totalCols}
              {@const leftPct = event.col * colWidth}
              {@const styles = eventTypeMap[event.type] || eventTypeMap.external}
              {@const eventId = event.id || event.title}
              {@const hasConflict = conflicts.has(eventId)}
              {@const evBg = event.itemColor ? event.itemColor + '22' : styles.bg}
              {@const evBorder = event.itemColor || styles.border}
              {@const isDragging = dragState?.event.id === event.id && dragState?.event.id != null}
              {@const isResizing =
                resizeState?.event.id === event.id && resizeState?.event.id != null}
              {@const isPast = isEventPast(event)}
              {@const displayStartHour = isResizing
                ? resizeState!.currentStartHour
                : event.startHour}
              {@const displayDuration = isResizing ? resizeState!.currentDuration : event.duration}
              {@const displayTop = (displayStartHour - START_HOUR) * HOUR_HEIGHT}
              {@const displayHeight = displayDuration * HOUR_HEIGHT}
              <div
                class="cal-event"
                class:cal-event--past={isPast}
                class:cal-event--conflict={hasConflict}
                class:cal-event--interactive={canDrag(event)}
                class:cal-event--dragging={isDragging}
                class:cal-event--resizing={isResizing}
                role="button"
                tabindex="0"
                style="
                  top: {displayTop}px;
                  height: {Math.max(displayHeight, 20)}px;
                  left: calc({leftPct}% + 2px);
                  width: calc({colWidth}% - 4px);
                  --ev-bg: {evBg};
                  --ev-border: {evBorder};
                "
                aria-label="{formatHourAmPm(event.startHour)} - {formatHourAmPm(
                  event.startHour + event.duration,
                )}: {event.title}{hasConflict ? ' (conflict)' : ''}"
                onclick={() => {
                  if (!dragState && !resizeState && !justDragged) oneventclick(event);
                }}
                oncontextmenu={(e) => oneventcontextmenu(e, event)}
                onpointerdown={(e) => handleDragStart(e, event)}
                onpointermove={(e) => handleDragMove(e)}
                onpointerup={(e) => handleDragEnd(e)}
                onpointercancel={() => {
                  dragState = null;
                  resizeState = null;
                  pendingPointer = null;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') oneventclick(event);
                  if (e.key === 'F10' && e.shiftKey) {
                    e.preventDefault();
                    const el = e.currentTarget as HTMLElement;
                    const rect = el.getBoundingClientRect();
                    oneventcontextmenu(
                      new MouseEvent('contextmenu', {
                        clientX: rect.left + rect.width / 2,
                        clientY: rect.top + rect.height / 2,
                      }),
                      event,
                    );
                  }
                }}
              >
                {#if canDrag(event) && displayHeight > 24}
                  <div class="cal-event-resize-handle cal-event-resize-handle--top"></div>
                  <div class="cal-event-resize-handle cal-event-resize-handle--bottom"></div>
                {/if}
                <div class="cal-event-title">{event.title}</div>
                {#if displayHeight > 28}
                  <div class="cal-event-time font-mono">
                    {formatStartTime(displayStartHour)} - {formatEndTime(
                      displayStartHour,
                      displayDuration,
                    )}
                  </div>
                {/if}
                {#if displayHeight > 42 && event.status && event.type !== 'external'}
                  <span class="cal-event-status cal-event-status--{event.status}">
                    {event.status === 'free'
                      ? 'Free'
                      : event.status === 'busy'
                        ? 'Defended'
                        : event.status === 'locked'
                          ? 'Locked'
                          : event.status === 'completed'
                            ? 'Done'
                            : event.status}
                  </span>
                {/if}
                {#if canComplete(event)}
                  <button
                    class="cal-event-complete-btn"
                    title="Mark as done"
                    aria-label="Mark {event.title} as done"
                    onclick={(e) => {
                      e.stopPropagation();
                      oncomplete(event);
                    }}
                  >
                    <Check size={12} />
                  </button>
                {/if}
                {#if hasConflict}
                  <span
                    class="conflict-badge"
                    title="Overlaps with {conflicts.get(eventId)?.join(', ')}"
                  >
                    <AlertTriangle size={10} strokeWidth={2} />
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}

        <!-- Drag ghost element -->
        {#if dragState}
          {@const ghostTop = (dragState.currentStartHour - START_HOUR) * HOUR_HEIGHT}
          {@const ghostHeight = dragState.event.duration * HOUR_HEIGHT}
          {@const ghostStyles = eventTypeMap[dragState.event.type] || eventTypeMap.external}
          {@const ghostBorder = dragState.event.itemColor || ghostStyles.border}
          {@const timeColWidth = 56}
          <div
            class="cal-event cal-event--ghost"
            style="
              top: {ghostTop}px;
              height: {Math.max(ghostHeight, 20)}px;
              left: calc({timeColWidth}px + {dragState.currentDayIndex} * ((100% - {timeColWidth}px) / 7) + 2px);
              width: calc((100% - {timeColWidth}px) / 7 - 4px);
              border-left-color: {ghostBorder};
            "
          >
            <div class="cal-event-title">{dragState.event.title}</div>
            <div class="cal-event-time font-mono">
              {formatStartTime(dragState.currentStartHour)} - {formatEndTime(
                dragState.currentStartHour,
                dragState.event.duration,
              )}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  // Loading Skeleton
  .loading-skeleton {
    @include card;
    overflow: hidden;
  }

  .skeleton-header {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }

  .skeleton-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    padding: var(--space-4);
    min-height: 320px;
  }

  .skeleton-day-col {
    @include flex-col;
    padding: 0 var(--space-1);
  }

  .skeleton-day-label {
    width: 40px;
    height: 14px;
    border-radius: var(--radius-sm);
  }

  .skeleton-block {
    width: 100%;
    border-radius: var(--radius-sm);
  }

  .skeleton-pulse {
    background: var(--color-surface-hover);
    animation: skeleton-pulse 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  // Calendar Container
  .calendar-container {
    @include card;
    overflow: hidden;
  }

  // Day Headers
  .day-headers {
    display: grid;
    grid-template-columns: 64px repeat(7, 1fr);
    border-bottom: 1px solid var(--color-border);
  }

  .time-col-header {
    border-right: 1px solid var(--color-border);
  }

  .day-header {
    padding: var(--space-3);
    text-align: center;
    border-left: 1px solid var(--color-border);
    @include flex-col;
    align-items: center;
    gap: 2px;

    &-name {
      @include mono-label;
      color: var(--color-text-tertiary);
    }

    &-date {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text);
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;

      &--today {
        color: var(--color-accent);
      }
    }
  }

  .today-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    display: inline-block;
  }

  // All-day events row
  .all-day-row {
    display: grid;
    grid-template-columns: 64px repeat(7, 1fr);
    border-bottom: 1px solid var(--color-border);
  }

  .all-day-label {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: var(--space-2);
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .all-day-cell {
    border-left: 1px solid var(--color-border);
    padding: var(--space-1);
    @include flex-col;
    gap: 2px;
    min-height: 28px;
  }

  .all-day-event {
    display: block;
    width: 100%;
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    text-align: left;
    transition: filter var(--transition-fast);

    &:hover {
      filter: brightness(0.95);
    }

    &-title {
      font-size: 0.6875rem;
      font-weight: 500;
      color: var(--color-text);
      @include text-truncate;
    }

    &--past {
      opacity: 0.45;
    }
  }

  // Time Grid
  $grid-chrome-height: 340px;

  .time-grid-scroll {
    overflow-y: auto;
    max-height: calc(100vh - #{$grid-chrome-height});
  }

  .time-grid {
    display: grid;
    grid-template-columns: 64px repeat(7, 1fr);
    position: relative;
  }

  .time-labels-col {
    position: relative;
    border-right: 1px solid var(--color-border);
  }

  .time-label {
    position: absolute;
    right: var(--space-2);
    transform: translateY(-50%);
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    white-space: nowrap;
    pointer-events: none;
  }

  .hour-lines-overlay {
    position: absolute;
    top: 0;
    left: 64px;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }

  .day-col {
    position: relative;
    border-left: 1px solid var(--color-border);

    &--today {
      background: var(--color-accent-muted);
    }
  }

  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-bottom: 1px solid var(--color-border);
  }

  // Events
  .cal-event {
    position: absolute;
    z-index: 10;
    border-radius: var(--radius-md);
    border-left: 3px solid var(--ev-border);
    background-color: var(--ev-bg);
    padding: var(--space-1) var(--space-2);
    overflow: hidden;
    cursor: pointer;
    transition: filter var(--transition-fast);

    &:hover {
      filter: brightness(0.95);
    }

    &-title {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--color-text);
      @include text-truncate;
      line-height: 1.3;
    }

    &-time {
      font-size: 0.625rem;
      color: var(--color-text-secondary);
      line-height: 1.3;
    }

    &-status {
      display: inline-block;
      font-size: 0.5625rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 1px 4px;
      border-radius: var(--radius-sm);
      line-height: 1.4;
      margin-top: 1px;

      &--free {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
      }

      &--busy {
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
      }

      &--locked {
        color: var(--color-text-secondary);
        background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
      }
    }

    &--conflict {
      box-shadow: 0 0 0 1px var(--color-warning-amber);
    }

    &--interactive {
      cursor: pointer;
      touch-action: none;
    }

    &--past {
      opacity: 0.45;
    }

    &--dragging {
      opacity: 0.3;
      cursor: grabbing;
    }

    &--resizing {
      z-index: 15;
    }

    &--ghost {
      border: 2px dashed var(--color-border);
      background: var(--color-surface-hover) !important;
      z-index: $z-dropdown;
      pointer-events: none;
      opacity: 0.8;
    }
  }

  .cal-event-resize-handle {
    position: absolute;
    left: 0;
    right: 0;
    height: 6px;
    cursor: ns-resize;
    z-index: 2;

    &--top {
      top: 0;
      border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    &--bottom {
      bottom: 0;
      border-radius: 0 0 var(--radius-md) var(--radius-md);
    }

    &:hover {
      background: color-mix(in srgb, var(--ev-border) 20%, transparent);
    }
  }

  .cal-event-complete-btn {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    border: 1.5px solid var(--color-success);
    background: transparent;
    color: var(--color-success);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.15s,
      background 0.15s;
    z-index: 2;
    padding: 0;

    &:hover {
      background: var(--color-success);
      color: var(--color-accent-text);
    }
  }

  .cal-event:hover .cal-event-complete-btn {
    opacity: 1;
  }

  .time-grid--dragging {
    cursor: grabbing;
    user-select: none;
  }

  .conflict-badge {
    position: absolute;
    top: 2px;
    right: 4px;
    @include flex-center;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--color-warning-amber-bg);
    color: var(--color-warning-amber);
  }
</style>
