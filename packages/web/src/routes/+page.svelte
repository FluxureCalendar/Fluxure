<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import {
    schedule,
    habits as habitsApi,
    tasks as tasksApi,
    meetings as meetingsApi,
    settings as settingsApi,
  } from '$lib/api';
  import { getCachedSettings, setCachedSettings } from '$lib/cache.svelte';
  import { quickAdd, type QuickAddResult } from '$lib/api';
  import Plus from 'lucide-svelte/icons/plus';
  import Loader from 'lucide-svelte/icons/loader';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import { subscribe as subscribeWs } from '$lib/ws';
  import EventDetailPanel from './EventDetailPanel.svelte';
  import EventContextMenu from './EventContextMenu.svelte';
  import HabitResizePrompt from './HabitResizePrompt.svelte';
  import { showSuccess, showError, showInfo } from '$lib/notifications.svelte';
  import { SvelteDate } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    TIME_TICK_INTERVAL_MS,
    HOUR_HEIGHT_PX,
    addDays,
    subDays,
    differenceInMinutes,
    startOfDayInTz,
    toDateStr,
    TZDate,
    getDay,
    addMinutes,
  } from '@fluxure/shared';
  import QualityGauge from './QualityGauge.svelte';
  import DashboardChanges from './DashboardChanges.svelte';
  import WeekCalendarGrid from './WeekCalendarGrid.svelte';
  import { type CalEvent, eventTypeMap, legendItems, mapApiEvents } from './dashboard-utils';

  let userTimezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  let currentWeekStart = $state(getMonday(new Date()));
  let loading = $state(true);
  let error = $state('');

  let quickAddInput = $state('');
  let quickAddLoading = $state(false);
  let quickAddError = $state('');
  let quickAddSuccess = $state('');

  async function handleQuickAdd() {
    const input = quickAddInput.trim();
    if (!input || quickAddLoading) return;
    quickAddLoading = true;
    quickAddError = '';
    quickAddSuccess = '';
    try {
      const result: QuickAddResult = await quickAdd.parse(input);
      if (result.created) {
        const name = result.parsed?.name || input;
        quickAddSuccess = `Created ${result.type}: ${name}`;
        quickAddInput = '';
        await refreshEventsSilently();
      } else {
        quickAddError = result.error || 'Could not parse input. Try: "Gym MWF 7am 1h"';
      }
    } catch (err) {
      quickAddError = err instanceof Error ? err.message : 'Failed to create item';
    } finally {
      quickAddLoading = false;
    }
  }

  // Auto-clear success message after 4 seconds
  $effect(() => {
    if (quickAddSuccess) {
      const timer = setTimeout(() => {
        quickAddSuccess = '';
      }, 4000);
      return () => clearTimeout(timer);
    }
  });

  let selectedEvent = $state<CalEvent | null>(null);

  let contextMenu = $state<{ x: number; y: number; event: CalEvent } | null>(null);

  let scrollContainer: HTMLDivElement | undefined = $state();

  /** Get the hour (fractional, 0-24) of a Date in the user's timezone */
  function getHourInTz(date: Date): number {
    const tzd = new TZDate(date, userTimezone);
    return tzd.getHours() + tzd.getMinutes() / 60;
  }

  /** Get the day of week (0=Sun..6=Sat) of a Date in the user's timezone */
  function getDayInTz(date: Date): number {
    return getDay(new TZDate(date, userTimezone));
  }

  /** Get the UTC instant that corresponds to midnight of a local date in the user's timezone. */
  function midnightInTz(year: number, month: number, day: number): number {
    const tzd = new TZDate(year, month, day, 0, 0, 0, userTimezone);
    return tzd.getTime();
  }

  // Re-assigned once real timezone is known from settingsApi.get()
  function getMonday(date: Date): SvelteDate {
    const tzd = new TZDate(date, userTimezone);
    const dayOfWeek = getDay(tzd); // 0=Sun..6=Sat
    const offset = (dayOfWeek + 6) % 7; // days back to Monday
    const monday = subDays(tzd, offset);
    return new SvelteDate(startOfDayInTz(new Date(monday.getTime()), userTimezone));
  }

  function prevWeek() {
    currentWeekStart = new SvelteDate(subDays(currentWeekStart, 7));
  }

  function nextWeek() {
    currentWeekStart = new SvelteDate(addDays(currentWeekStart, 7));
  }

  function goToday() {
    currentWeekStart = getMonday(new Date());
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function getWeekDates(start: Date): SvelteDate[] {
    return Array.from({ length: 7 }, (_, i) => new SvelteDate(addDays(start, i)));
  }

  function formatWeekRange(start: Date): string {
    const end = addDays(start, 6);
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    if (start.getMonth() === end.getMonth()) {
      return `${monthNames[start.getMonth()]} ${start.getDate()} \u2013 ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${monthNames[start.getMonth()]} ${start.getDate()} \u2013 ${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }

  let deleting = $state(false);
  let rescheduling = $state(false);
  let rescheduleCooldown = $state(false);
  let rescheduleResult = $state<{
    message: string;
    operationsApplied: number;
    unschedulable: unknown[];
  } | null>(null);

  let events = $state<CalEvent[]>([]);

  // Computes next event end time and sets a timeout for that moment to minimize recomputations
  let nowTick = $state(0);
  $effect(() => {
    const now = Date.now();
    // Find the next event end time that is in the future
    const futureEnds = events.map((e) => new Date(e.endISO).getTime()).filter((t) => t > now);
    if (futureEnds.length === 0) {
      // No future events — fall back to a periodic check
      const interval = setInterval(() => {
        nowTick++;
      }, TIME_TICK_INTERVAL_MS);
      return () => clearInterval(interval);
    }
    const nextTransition = Math.min(...futureEnds);
    const delay = Math.max(1000, nextTransition - now + 500); // +500ms buffer
    const timer = setTimeout(() => {
      nowTick++;
    }, delay);
    return () => clearTimeout(timer);
  });

  /** Returns true if the event's end time is in the past */
  function isEventPast(event: CalEvent): boolean {
    void nowTick;
    return new Date(event.endISO).getTime() < Date.now();
  }

  function isToday(date: Date): boolean {
    return toDateStr(date, userTimezone) === toDateStr(new Date(), userTimezone);
  }

  /** Returns the current time position in pixels from grid top */
  function getCurrentTimePosition(): number {
    const now = new Date();
    const currentHour = getHourInTz(now);
    return currentHour * HOUR_HEIGHT_PX;
  }

  /** Returns the day index (0=Mon..6=Sun) for today, or -1 if not in current week */
  function getTodayDayIndex(): number {
    const weekDates = getWeekDates(currentWeekStart);
    for (let i = 0; i < weekDates.length; i++) {
      if (isToday(weekDates[i])) return i;
    }
    return -1;
  }

  function fetchWeekBounds() {
    const weekDates = getWeekDates(currentWeekStart);
    const mon = weekDates[0];
    const startMs = midnightInTz(mon.getFullYear(), mon.getMonth(), mon.getDate());
    const sun = weekDates[6];
    const nextDay = addDays(sun, 1);
    const endMs = midnightInTz(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate());
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    };
  }

  async function fetchEvents() {
    loading = true;
    error = '';
    try {
      const { start, end } = fetchWeekBounds();
      const apiEvents = await schedule.getEvents(start, end);
      events = mapApiEvents(apiEvents, getHourInTz, getDayInTz);
    } catch (err) {
      if ((err as { handled?: boolean }).handled) return;
      if (err instanceof TypeError) {
        error = "You're offline — check your connection";
      } else {
        error = `Failed to load events: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
      events = [];
    } finally {
      loading = false;
    }
  }

  /** Build a lightweight fingerprint for shallow equality comparison */
  function eventsFingerprint(evts: CalEvent[]): string {
    return evts.map((e) => `${e.id || e.title}|${e.startISO}|${e.endISO}`).join(';');
  }

  /** Silent refresh — updates events in-place without showing the loading skeleton. */
  async function refreshEventsSilently() {
    try {
      const { start, end } = fetchWeekBounds();
      const apiEvents = await schedule.getEvents(start, end);
      const newEvents = mapApiEvents(apiEvents, getHourInTz, getDayInTz);
      // Skip update if events haven't changed to avoid unnecessary recomputation
      if (eventsFingerprint(newEvents) !== eventsFingerprint(events)) {
        events = newEvents;
      }
    } catch {
      // Silent refresh failure is non-critical; the user already has stale data visible
    }
  }

  function handleEventClick(event: CalEvent) {
    contextMenu = null;
    selectedEvent = event;
  }

  function handleEventContextMenu(e: MouseEvent, event: CalEvent) {
    e.preventDefault();
    selectedEvent = null;
    contextMenu = { x: e.clientX, y: e.clientY, event };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function closeDetail() {
    selectedEvent = null;
  }

  async function confirmDelete(event: CalEvent) {
    if (!event.itemId) return;
    error = '';
    deleting = true;
    const entityId = event.itemId.split('__')[0];
    try {
      if (event.type === 'habit') await habitsApi.delete(entityId);
      else if (event.type === 'task') await tasksApi.delete(entityId);
      else if (event.type === 'meeting') await meetingsApi.delete(entityId);
      else return;
      // Optimistic remove of all events belonging to this entity
      events = events.filter((e) => e.itemId?.split('__')[0] !== entityId);
      closeDetail();
      closeContextMenu();
      // WS will refresh when reschedule finishes
    } catch {
      error = 'Failed to delete event.';
      await refreshEventsSilently();
    } finally {
      deleting = false;
    }
  }

  async function handleReschedule() {
    error = '';
    rescheduling = true;
    rescheduleResult = null;
    try {
      const result = await schedule.run();
      rescheduleResult = result;
      if (result.operationsApplied > 0) {
        await fetchEvents();
      }
      // Cooldown prevents repeated requests when nothing changed
      rescheduleCooldown = true;
      setTimeout(
        () => {
          rescheduleCooldown = false;
        },
        result.operationsApplied > 0 ? 10_000 : 30_000,
      );
    } catch {
      error = 'Failed to reschedule.';
    } finally {
      rescheduling = false;
    }
  }

  function canEdit(event: CalEvent): boolean {
    return !!event.itemId && ['habit', 'task', 'meeting'].includes(event.type);
  }

  function editEntity(event: CalEvent) {
    if (!event.itemId) return;
    const entityId = event.itemId.split('__')[0];
    const typeRoutes: Record<string, string> = {
      habit: 'habits',
      task: 'tasks',
      meeting: 'meetings',
    };
    const route = typeRoutes[event.type];
    if (route) {
      closeDetail();
      closeContextMenu();
      goto(resolve(`/${route}?edit=${entityId}` as '/'));
    }
  }

  function canDelete(event: CalEvent): boolean {
    return !!event.itemId && ['habit', 'task', 'meeting'].includes(event.type);
  }

  function canLock(event: CalEvent): boolean {
    return event.type === 'habit' && !!event.itemId;
  }

  function isLocked(event: CalEvent): boolean {
    return event.status === 'locked';
  }

  async function toggleLock(event: CalEvent) {
    if (!event.id) return;
    error = '';
    const newLocked = !isLocked(event);
    try {
      // Optimistic update — only this specific event
      events = events.map((e) =>
        e.id === event.id ? { ...e, status: newLocked ? 'locked' : 'free' } : e,
      );
      await schedule.lockEvent(event.id, newLocked);
      // Reschedule runs async; WS will refresh when done
    } catch {
      error = 'Failed to toggle lock.';
      await refreshEventsSilently();
    }
    closeContextMenu();
    closeDetail();
  }

  function canComplete(event: CalEvent): boolean {
    if (event.type === 'external' || event.type === 'manual') return false;
    if (event.status === 'completed') return false;
    return !!event.id;
  }

  async function completeEvent(event: CalEvent) {
    if (!event.id) return;
    error = '';
    try {
      // Optimistic update
      events = events.map((e) => (e.id === event.id ? { ...e, status: 'completed' } : e));
      await schedule.complete(event.id);
      // WS will refresh when reschedule finishes
    } catch {
      error = 'Failed to complete event.';
      await refreshEventsSilently();
    }
  }

  async function moveEvent(event: CalEvent, deltaMinutes: number) {
    if (!event.id || !event.startISO || !event.endISO) return;
    closeContextMenu();
    const newStartISO = addMinutes(new Date(event.startISO), deltaMinutes).toISOString();
    const newEndISO = addMinutes(new Date(event.endISO), deltaMinutes).toISOString();

    // Optimistic update
    const newStartHour = event.startHour + deltaMinutes / 60;
    events = events.map((e) =>
      e.id === event.id
        ? { ...e, startHour: newStartHour, startISO: newStartISO, endISO: newEndISO }
        : e,
    );

    try {
      await schedule.moveEvent(event.id, newStartISO, newEndISO);
    } catch {
      error = 'Failed to move event.';
      await refreshEventsSilently();
    }
  }

  let habitResizePrompt = $state<{
    event: CalEvent;
    newStart: string;
    newEnd: string;
    editMin: number; // editable min duration (minutes)
    editMax: number; // editable max duration (minutes)
  } | null>(null);

  function canDrag(event: CalEvent): boolean {
    return (
      ['habit', 'task', 'meeting', 'focus', 'external'].includes(event.type) && !event.isAllDay
    );
  }

  async function handleGridMove(
    eventId: string,
    newStartISO: string,
    newEndISO: string,
    isExternal: boolean,
  ) {
    // Optimistic update
    const newStartDate = new Date(newStartISO);
    const newStartHour = getHourInTz(newStartDate);
    const newDayOfWeek = getDayInTz(newStartDate);
    const newDayIndex = newDayOfWeek === 0 ? 6 : newDayOfWeek - 1;

    events = events.map((e) =>
      e.id === eventId
        ? {
            ...e,
            dayIndex: newDayIndex,
            startHour: newStartHour,
            startISO: newStartISO,
            endISO: newEndISO,
          }
        : e,
    );

    try {
      if (isExternal) {
        await schedule.moveExternalEvent(eventId, newStartISO, newEndISO);
      } else {
        await schedule.moveEvent(eventId, newStartISO, newEndISO);
      }
    } catch {
      error = 'Failed to move event.';
      await refreshEventsSilently();
    }
  }

  async function handleGridResize(
    eventId: string,
    newStart: string,
    newEnd: string,
    _isExternal: boolean,
  ) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    await applyResize(event, newStart, newEnd);
  }

  function handleGridHabitResize(
    event: CalEvent,
    newStart: string,
    newEnd: string,
    durationMin: number,
  ) {
    const defaultMax = Math.ceil((durationMin + 15) / 15) * 15;
    habitResizePrompt = {
      event,
      newStart,
      newEnd,
      editMin: durationMin,
      editMax: Math.max(defaultMax, durationMin),
    };
  }

  async function applyResize(event: CalEvent, newStart: string, newEnd: string) {
    // Optimistic update
    const newStartDate = new Date(newStart);
    const newEndDate = new Date(newEnd);
    const newDuration = differenceInMinutes(newEndDate, newStartDate) / 60;
    const weekDates = getWeekDates(currentWeekStart);
    const day = weekDates[event.dayIndex];
    const dayMidnight = new Date(midnightInTz(day.getFullYear(), day.getMonth(), day.getDate()));
    const newStartHour = differenceInMinutes(newStartDate, dayMidnight) / 60;

    events = events.map((e) =>
      e.id === event.id
        ? {
            ...e,
            startHour: newStartHour,
            duration: newDuration,
            startISO: newStart,
            endISO: newEnd,
          }
        : e,
    );

    try {
      if (event.type === 'external') {
        await schedule.moveExternalEvent(event.id!, newStart, newEnd);
      } else {
        await schedule.moveEvent(event.id!, newStart, newEnd);
      }
      // WS will reconcile if server adjusted the times
    } catch {
      error = 'Failed to resize event.';
      await refreshEventsSilently();
    }
  }

  async function handleHabitResizeChoice(choice: 'this' | 'habit') {
    if (!habitResizePrompt) return;
    if (habitResizePrompt.editMin > habitResizePrompt.editMax) return;
    const { event, newStart, newEnd, editMin, editMax } = habitResizePrompt;
    habitResizePrompt = null;

    if (choice === 'habit') {
      const habitId = event.itemId?.split('__')[0];
      if (habitId) {
        try {
          await habitsApi.update(habitId, { durationMin: editMin, durationMax: editMax });
        } catch {
          error = 'Failed to update habit duration.';
          return;
        }
      }
    }

    await applyResize(event, newStart, newEnd);
  }

  function formatFullDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: userTimezone,
    });
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: userTimezone,
    });
  }

  function scrollToCurrentTime() {
    if (!scrollContainer) return;
    const now = new Date();
    const todayInWeek = getTodayDayIndex() >= 0;
    // Scroll to current time if viewing current week, otherwise scroll to 7 AM
    const targetHour = todayInWeek ? getHourInTz(now) - 1 : 7;
    const scrollTarget = Math.max(0, targetHour * HOUR_HEIGHT_PX);
    scrollContainer.scrollTop = scrollTarget;
  }

  // Use browser timezone as optimistic default; re-fetch if stored timezone differs
  const cachedConfig = getCachedSettings();
  if (cachedConfig?.settings?.timezone) {
    userTimezone = cachedConfig.settings.timezone;
    currentWeekStart = getMonday(new Date());
  }
  // Re-fetch events only if timezone changed
  settingsApi
    .get()
    .then((config) => {
      setCachedSettings(config);
      if (config.settings?.timezone && config.settings.timezone !== userTimezone) {
        userTimezone = config.settings.timezone;
        currentWeekStart = getMonday(new Date());
        // $effect below re-fetches when week changes
      }
    })
    .catch((err) => {
      if (!(err as { handled?: boolean }).handled) {
        showError('Failed to load settings');
      }
    });

  $effect(() => {
    const _week = currentWeekStart;
    fetchEvents();
  });

  // Handle OAuth callback redirect
  $effect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') {
      showSuccess('Google Calendar connected');
      const url = new URL(window.location.href);
      url.searchParams.delete('google');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  });

  $effect(() => {
    if (!loading && scrollContainer) {
      requestAnimationFrame(() => scrollToCurrentTime());
    }
  });

  $effect(() => {
    if (rescheduleResult) {
      const timer = setTimeout(() => {
        rescheduleResult = null;
      }, 5000);
      return () => clearTimeout(timer);
    }
  });

  // Auto-refresh calendar on WebSocket schedule updates
  $effect(() => {
    const unsubscribe = subscribeWs((msg) => {
      if (msg.type === 'schedule_updated') {
        refreshEventsSilently();
        showInfo(msg.reason || 'Schedule updated');
      }
    });
    return () => unsubscribe();
  });
</script>

<svelte:head>
  <title>{pageTitle('Schedule')}</title>
</svelte:head>

<div class="dashboard">
  <!-- Header -->
  <header class="dashboard-header">
    <div class="header-left">
      <h1 class="header-title">Schedule</h1>
      <span class="header-date-range font-mono">{formatWeekRange(currentWeekStart)}</span>
    </div>
    <div class="header-nav">
      <QualityGauge />
      <button
        class="reschedule-btn"
        onclick={handleReschedule}
        disabled={rescheduling || rescheduleCooldown}
        aria-busy={rescheduling}
      >
        <RefreshCw size={16} strokeWidth={1.5} class={rescheduling ? 'spinning' : ''} />
        {rescheduling ? 'Scheduling...' : 'Reschedule'}
      </button>
      <button onclick={prevWeek} aria-label="Previous week" class="nav-btn">
        <ChevronLeft size={16} strokeWidth={1.5} />
      </button>
      <button onclick={goToday} class="today-btn"> Today </button>
      <button onclick={nextWeek} aria-label="Next week" class="nav-btn">
        <ChevronRight size={16} strokeWidth={1.5} />
      </button>
    </div>
  </header>

  <!-- Quick Add Bar -->
  <form
    class="quick-add"
    onsubmit={(e) => {
      e.preventDefault();
      handleQuickAdd();
    }}
  >
    <input
      type="text"
      class="quick-add-input"
      placeholder="Quick add... (e.g., 'Gym MWF 7am 1h')"
      aria-label="Quick add item"
      bind:value={quickAddInput}
      disabled={quickAddLoading}
    />
    <button
      type="submit"
      class="quick-add-btn"
      disabled={quickAddLoading || !quickAddInput.trim()}
      aria-label="Add item"
    >
      {#if quickAddLoading}
        <Loader size={16} strokeWidth={1.5} class="spinning" />
      {:else}
        <Plus size={16} strokeWidth={1.5} />
      {/if}
    </button>
    {#if quickAddSuccess}
      <span class="quick-add-success" role="status" aria-live="polite">{quickAddSuccess}</span>
    {/if}
    {#if quickAddError}
      <span class="quick-add-error" role="alert" aria-live="assertive">{quickAddError}</span>
    {/if}
  </form>

  <div role="alert" aria-live="assertive">
    {#if error}
      <div class="error-banner">{error}</div>
    {/if}
  </div>

  <div aria-live="polite">
    {#if rescheduleResult}
      <div class="reschedule-banner">
        {#if rescheduleResult.operationsApplied === 0}
          &#10003; Schedule is already optimal — no changes needed
        {:else}
          &#10003; {rescheduleResult.operationsApplied} changes applied
        {/if}
        {#if rescheduleResult.unschedulable?.length > 0}
          &middot; {rescheduleResult.unschedulable.length} items couldn't be scheduled
        {/if}
      </div>
    {/if}
  </div>

  <WeekCalendarGrid
    {events}
    weekDates={getWeekDates(currentWeekStart)}
    {loading}
    {dayNames}
    {eventTypeMap}
    {userTimezone}
    {isToday}
    {getCurrentTimePosition}
    {getTodayDayIndex}
    {isEventPast}
    {canDrag}
    {canComplete}
    oneventclick={handleEventClick}
    oneventcontextmenu={handleEventContextMenu}
    oncomplete={completeEvent}
    onmove={handleGridMove}
    onresize={handleGridResize}
    onhabitresize={handleGridHabitResize}
    onscrollcontainer={(el) => {
      scrollContainer = el;
    }}
    {midnightInTz}
  />

  {#if !loading}
    <!-- Legend -->
    <div class="legend">
      {#each legendItems as item (item.type)}
        {@const styles = eventTypeMap[item.type]}
        <span class="legend-chip">
          <span class="legend-dot" style="background-color: {styles.border};"></span>
          {item.label}
        </span>
      {/each}
    </div>

    <!-- Recent Changes -->
    <DashboardChanges {userTimezone} />
  {/if}
</div>

<!-- Event Detail Slide-over -->
{#if selectedEvent}
  <EventDetailPanel
    event={selectedEvent}
    {eventTypeMap}
    conflictTitles={[]}
    {deleting}
    onclose={closeDetail}
    onedit={editEntity}
    oncomplete={completeEvent}
    ontogglelock={toggleLock}
    ondelete={confirmDelete}
    {formatFullDate}
    {formatTime}
    {canEdit}
    {canComplete}
    {canLock}
    {canDelete}
    {isLocked}
  />
{/if}

<!-- Context Menu -->
{#if contextMenu}
  <EventContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    event={contextMenu.event}
    {eventTypeMap}
    onclose={closeContextMenu}
    onviewdetails={handleEventClick}
    onedit={editEntity}
    oncomplete={completeEvent}
    ontogglelock={toggleLock}
    onmove={moveEvent}
    ondelete={(event) => {
      handleEventClick(event);
    }}
    {formatTime}
    {canEdit}
    {canComplete}
    {canLock}
    {canDrag}
    {canDelete}
    {isLocked}
  />
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      if (habitResizePrompt) {
        habitResizePrompt = null;
      } else {
        closeDetail();
        closeContextMenu();
      }
    }
  }}
/>

<!-- Habit resize prompt modal -->
{#if habitResizePrompt}
  <HabitResizePrompt
    event={habitResizePrompt.event}
    newStart={habitResizePrompt.newStart}
    newEnd={habitResizePrompt.newEnd}
    bind:editMin={habitResizePrompt.editMin}
    bind:editMax={habitResizePrompt.editMax}
    onclose={() => {
      habitResizePrompt = null;
    }}
    onchoice={handleHabitResizeChoice}
  />
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .dashboard {
    @include flex-col(var(--space-4));
  }

  .dashboard-header {
    @include flex-between;

    @include mobile {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
  }

  .header-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .header-date-range {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .header-nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);

    @include mobile {
      align-self: flex-end;
    }
  }

  .nav-btn {
    @include flex-center;
    @include touch-target;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    @include hover-surface;
  }

  .today-btn {
    padding: var(--space-1) var(--space-4);
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    background: transparent;
    color: var(--color-accent);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);

    &:hover {
      background: var(--color-accent);
      color: var(--color-accent-text);
    }
  }

  .reschedule-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      opacity var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
      border-color: var(--color-accent-hover);
    }

    &:disabled {
      opacity: var(--opacity-disabled);
      cursor: not-allowed;
    }

    :global(.spinning) {
      animation: spin 1s linear infinite;
    }
  }

  .reschedule-banner {
    padding: var(--space-3) var(--space-4);
    background: var(--color-success-muted);
    color: var(--color-success);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    animation: fadeIn 200ms ease;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  .quick-add {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    position: relative;
  }

  .quick-add-input {
    flex: 1;
    min-width: 200px;
    height: 36px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.875rem;
    font-family: inherit;
    outline: none;
    transition: border-color var(--transition-fast);

    &::placeholder {
      color: var(--color-text-tertiary);
    }

    &:focus,
    &:focus-visible {
      border-color: var(--color-accent);
      outline: 2px solid var(--color-accent-muted);
      outline-offset: -1px;
    }

    &:disabled {
      opacity: var(--opacity-disabled);
    }
  }

  .quick-add-btn {
    @include flex-center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-text);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      opacity var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
      border-color: var(--color-accent-hover);
    }

    &:disabled {
      opacity: var(--opacity-disabled);
      cursor: not-allowed;
    }

    :global(.spinning) {
      animation: spin 1s linear infinite;
    }
  }

  .quick-add-success {
    font-size: 0.8125rem;
    color: var(--color-success);
    animation: fadeIn 200ms ease;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  .quick-add-error {
    font-size: 0.8125rem;
    color: var(--color-danger);
    animation: fadeIn 200ms ease;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  .legend {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
    padding-top: var(--space-2);

    &-chip {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
    }

    &-dot {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      flex-shrink: 0;
    }
  }
</style>
