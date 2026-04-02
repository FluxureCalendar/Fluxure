<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { pageTitle } from '$lib/brand';
  import {
    schedule,
    habits as habitsApi,
    tasks as tasksApi,
    meetings as meetingsApi,
    settings as settingsApi,
  } from '$lib/api';
  import { getCachedSettings, setCachedSettings } from '$lib/cache.svelte';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import { subscribe as subscribeWs } from '$lib/ws';
  import EventDetailPanel from './dashboard/EventDetailPanel.svelte';
  import EventContextMenu from './dashboard/EventContextMenu.svelte';
  import HabitResizePrompt from './dashboard/HabitResizePrompt.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { isSyncing } from '$lib/sync-state.svelte';
  import { getAuthState } from '$lib/auth.svelte';
  import { SvelteDate } from 'svelte/reactivity';
  import { goto, replaceState } from '$app/navigation';
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
  import QualityGauge from './dashboard/QualityGauge.svelte';
  import DashboardChanges from './dashboard/DashboardChanges.svelte';
  import WeekCalendarGrid from './dashboard/WeekCalendarGrid.svelte';
  import {
    type CalEvent,
    eventTypeMap,
    legendItems,
    mapApiEvents,
  } from './dashboard/dashboard-utils';

  let userTimezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  let currentWeekStart = $state(getMonday(new Date()));
  let loading = $state(true);
  let settingsLoaded = $state(false);

  const auth = getAuthState();

  function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  let firstName = $derived(auth.user?.name?.split(' ')[0] ?? '');

  // Next event fetched independently from the view — always relative to "now"
  let absoluteNextEvent = $state<{ title: string; startISO: string } | null>(null);

  async function fetchNextEvent() {
    try {
      const now = new Date();
      const lookahead = addDays(now, 7);
      const apiEvents = await schedule.getEvents(now.toISOString(), lookahead.toISOString());
      const upcoming = apiEvents
        .filter((e: { start: string }) => new Date(e.start).getTime() > now.getTime())
        .sort(
          (a: { start: string }, b: { start: string }) =>
            new Date(a.start).getTime() - new Date(b.start).getTime(),
        );
      absoluteNextEvent = upcoming[0]
        ? { title: upcoming[0].title, startISO: upcoming[0].start }
        : null;
    } catch {
      // Non-critical — keep last known value
    }
  }

  // Ticks every minute to keep the "Next: ... in Xm" display fresh
  let headerTick = $state(0);
  $effect(() => {
    const interval = setInterval(() => {
      headerTick++;
    }, 60_000);
    return () => clearInterval(interval);
  });

  function formatRelativeTime(iso: string): string {
    void headerTick;
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return 'now';
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (rem === 0) return `in ${hrs}h`;
    return `in ${hrs}h ${rem}m`;
  }

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

  let pendingEventId = $state<string | null>(null);

  let deleting = $state(false);
  let rescheduling = $state(false);
  let rescheduleCooldown = $state(false);

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

  // Re-fetch next event when the current one's start time passes
  $effect(() => {
    if (!absoluteNextEvent) return;
    const msUntilStart = new Date(absoluteNextEvent.startISO).getTime() - Date.now();
    if (msUntilStart <= 0) {
      fetchNextEvent();
      return;
    }
    const timer = setTimeout(() => fetchNextEvent(), msUntilStart + 500);
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
    // error cleared
    try {
      const { start, end } = fetchWeekBounds();
      const apiEvents = await schedule.getEvents(start, end);
      events = mapApiEvents(apiEvents, getHourInTz, getDayInTz);
      fetchNextEvent();
    } catch (err) {
      if ((err as { handled?: boolean }).handled) return;
      if (err instanceof TypeError) {
        showToast("You're offline — check your connection", 'error');
      } else {
        showToast(
          `Failed to load events: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'error',
        );
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
      fetchNextEvent();
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
    // error cleared
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
      showToast('Failed to delete event.', 'error');
      await refreshEventsSilently();
    } finally {
      deleting = false;
    }
  }

  async function handleReschedule() {
    // error cleared
    rescheduling = true;
    try {
      const result = await schedule.run();
      if (result.operationsApplied > 0) {
        await fetchEvents();
        let msg = `${result.operationsApplied} changes applied`;
        if (result.unschedulable?.length > 0) {
          msg += ` · ${result.unschedulable.length} items couldn't be scheduled`;
        }
        showToast(msg, 'success');
      } else {
        showToast('Schedule is already optimal', 'info');
      }
      rescheduleCooldown = true;
      setTimeout(
        () => {
          rescheduleCooldown = false;
        },
        result.operationsApplied > 0 ? 10_000 : 30_000,
      );
    } catch {
      showToast('Failed to reschedule.', 'error');
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
    // error cleared
    const newLocked = !isLocked(event);
    try {
      // Optimistic update — only this specific event
      events = events.map((e) =>
        e.id === event.id ? { ...e, status: newLocked ? 'locked' : 'free' } : e,
      );
      await schedule.lockEvent(event.id, newLocked);
      // Reschedule runs async; WS will refresh when done
    } catch {
      showToast('Failed to toggle lock.', 'error');
      await refreshEventsSilently();
    }
    closeContextMenu();
    closeDetail();
  }

  function canComplete(event: CalEvent): boolean {
    if (event.type === 'external' || event.type === 'manual') return false;
    return !!event.id;
  }

  function isCompleted(event: CalEvent): boolean {
    return event.status === 'completed';
  }

  async function completeEvent(event: CalEvent) {
    if (!event.id) return;
    // error cleared
    try {
      if (isCompleted(event)) {
        // Uncomplete
        events = events.map((e) => (e.id === event.id ? { ...e, status: 'free' } : e));
        await schedule.uncomplete(event.id);
      } else {
        // Complete
        events = events.map((e) => (e.id === event.id ? { ...e, status: 'completed' } : e));
        await schedule.complete(event.id);
      }
      // WS will refresh when reschedule finishes
    } catch {
      showToast('Failed to complete event.', 'error');
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
      showToast('Failed to move event.', 'error');
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
      showToast('Failed to move event.', 'error');
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
      showToast('Failed to resize event.', 'error');
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
          showToast('Failed to update habit duration.', 'error');
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

  // Load user settings — use cache first, then fetch (only client-side)
  const cachedConfig = getCachedSettings();
  if (cachedConfig?.settings?.timezone) {
    userTimezone = cachedConfig.settings.timezone;
    currentWeekStart = getMonday(new Date());
  }

  onMount(() => {
    settingsApi
      .get()
      .then((config) => {
        setCachedSettings(config);
        if (config.settings?.timezone && config.settings.timezone !== userTimezone) {
          userTimezone = config.settings.timezone;
          currentWeekStart = getMonday(new Date());
        }
      })
      .catch(() => {})
      .finally(() => {
        settingsLoaded = true;
      });
  });

  $effect(() => {
    const _week = currentWeekStart;
    if (settingsLoaded) fetchEvents();
  });

  // Handle OAuth callback redirect (deferred until router is ready)
  onMount(() => {
    requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('google') === 'connected') {
        showToast('Google Calendar connected', 'success');
        const url = new URL(window.location.href);
        url.searchParams.delete('google');
        replaceState(url.pathname + url.search, {});
      }
    });
  });

  $effect(() => {
    if (!loading && scrollContainer) {
      requestAnimationFrame(() => scrollToCurrentTime());
    }
  });

  // Auto-refresh calendar on WebSocket schedule updates
  $effect(() => {
    const unsubscribe = subscribeWs((msg) => {
      if (msg.type === 'schedule_updated') {
        refreshEventsSilently();
      }
    });
    return () => unsubscribe();
  });

  // Deep link: open event detail panel from ?event=<id>&estart=<iso>
  // Uses $page store which is reactive to URL changes (including same-route navigations)
  $effect(() => {
    const eventId = $page.url.searchParams.get('event');
    if (!eventId) return;

    const eventStart = $page.url.searchParams.get('estart');

    // Clean URL immediately
    window.history.replaceState({}, '', '/');

    // Navigate to the week containing the event
    if (eventStart) {
      const startDate = new Date(decodeURIComponent(eventStart));
      if (!isNaN(startDate.getTime())) {
        const targetWeek = getMonday(startDate);
        if (targetWeek.getTime() !== currentWeekStart.getTime()) {
          currentWeekStart = targetWeek;
          // Events will reload via the currentWeekStart $effect — stash for when they arrive
          pendingEventId = eventId;
          return;
        }
      }
    }

    // Already on the right week — try to open now or stash
    if (events.length > 0) {
      const event = events.find((e) => e.id === eventId);
      if (event) selectedEvent = event;
    } else {
      pendingEventId = eventId;
    }
  });

  // Resolve pending event deep link once events load
  $effect(() => {
    if (!pendingEventId || events.length === 0) return;
    const event = events.find((e) => e.id === pendingEventId);
    if (event) selectedEvent = event;
    pendingEventId = null;
  });
</script>

<svelte:head>
  <title>{pageTitle('Dashboard')}</title>
</svelte:head>

<div class="dashboard">
  <!-- Header -->
  <header class="dashboard-header">
    <div class="header-left">
      <div class="header-top">
        <h1 class="header-title">{getGreeting()}{firstName ? `, ${firstName}` : ''}</h1>
      </div>
      <div class="header-meta">
        <span class="header-date-range">{formatWeekRange(currentWeekStart)}</span>
        {#if absoluteNextEvent}
          <span class="header-sep">&middot;</span>
          <span class="header-next"
            >Next: {absoluteNextEvent.title} {formatRelativeTime(absoluteNextEvent.startISO)}</span
          >
        {/if}
      </div>
    </div>
    <div class="header-nav">
      <QualityGauge />
      <button
        class="reschedule-btn"
        onclick={handleReschedule}
        disabled={rescheduling || rescheduleCooldown || isSyncing()}
        aria-busy={rescheduling}
      >
        <RefreshCw size={16} strokeWidth={1.5} class={rescheduling ? 'spinning' : ''} />
        {rescheduling ? 'Scheduling...' : 'Reschedule'}
      </button>
      <div class="week-nav">
        <button onclick={prevWeek} aria-label="Previous week" class="nav-btn">
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <button onclick={goToday} class="today-btn">Today</button>
        <button onclick={nextWeek} aria-label="Next week" class="nav-btn">
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  </header>

  <div class="legend">
    {#each legendItems as item (item.type)}
      {@const s = eventTypeMap[item.type]}
      <span class="legend-item">
        <span class="legend-dot" style="background: {s.border};"></span>
        {item.label}
      </span>
    {/each}
  </div>

  <WeekCalendarGrid
    {events}
    weekDates={getWeekDates(currentWeekStart)}
    {loading}
    {dayNames}
    {eventTypeMap}
    {isToday}
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
    {isCompleted}
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
  onclick={() => {
    if (contextMenu) closeContextMenu();
  }}
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
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .dashboard {
    @include flex-col(var(--space-5));
  }

  .legend {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-bottom: calc(-1 * var(--space-4));
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.625rem;
    color: var(--color-text-tertiary);
  }

  :global(.legend-dot) {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dashboard-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding-bottom: var(--space-4);

    @include mobile {
      flex-direction: column;
      gap: var(--space-3);
    }
  }

  .header-left {
    @include flex-col(var(--space-1));
  }

  .header-top {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }

  .header-title {
    font-family: $font-body;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .header-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .header-sep {
    opacity: 0.4;
  }

  .header-next {
    color: var(--color-text-secondary);
  }

  .header-nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;

    @include mobile {
      align-self: flex-end;
    }
  }

  .week-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-md);
    padding: 2px;
  }

  .nav-btn {
    @include flex-center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      background var(--transition-fast);

    &:hover {
      color: var(--color-text);
      background: var(--color-surface);
    }
  }

  .today-btn {
    padding: 0 var(--space-3);
    height: 26px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    font-weight: 500;
    font-family: $font-body;
    cursor: pointer;
    transition:
      color var(--transition-fast),
      background var(--transition-fast);

    &:hover {
      color: var(--color-text);
      background: var(--color-surface);
    }
  }

  .reschedule-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 400;
    font-family: $font-body;
    cursor: pointer;
    transition: all var(--transition-fast);

    &:hover:not(:disabled) {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    &:disabled {
      opacity: var(--opacity-disabled);
      cursor: not-allowed;
    }

    :global(.spinning) {
      animation: spin 1s linear infinite;
    }
  }
</style>
