<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getAuthState, checkAuth } from '$lib/auth.svelte';
  import { googleAuth } from '$lib/auth.svelte';
  import { settings, habits, calendars as calendarsApi } from '$lib/api';
  import { loadCalendars, getCalendars, setCalendars } from '$lib/calendars.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { pageTitle } from '$lib/brand';
  import { formatDuration } from '$lib/utils/format';
  import { Priority } from '@fluxure/shared';
  import type { DayOfWeek } from '@fluxure/shared';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Clock from 'lucide-svelte/icons/clock';
  import Sparkles from 'lucide-svelte/icons/sparkles';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import type { Calendar as CalendarType } from '@fluxure/shared';
  import { CalendarMode } from '@fluxure/shared';

  const TOTAL_STEPS = 5;

  let step = $state(1);
  let loading = $state(false);

  // Step 2: Connect Calendar
  let calendarChecking = $state(true); // starts true to prevent flash
  let calendarConnected = $state(false);
  let calendarError = $state('');
  let calendarList = $state<CalendarType[]>([]);

  // Step 3: Working Hours
  let workStart = $state('09:00');
  let workEnd = $state('17:00');

  // Step 4: First Habit
  let habitName = $state('');
  let habitDuration = $state(30);
  let habitIdealTime = $state('09:00');
  let habitFrequency = $state<'daily' | 'weekdays' | 'weekends'>('daily');

  function getDaysForFreq(freq: 'daily' | 'weekdays' | 'weekends'): { days: DayOfWeek[] } {
    if (freq === 'weekdays') return { days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
    if (freq === 'weekends') return { days: ['sat', 'sun'] };
    return { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
  }

  const authState = getAuthState();

  onMount(async () => {
    const user = await checkAuth();
    if (!user) {
      goto('/login');
    } else if (user.onboardingCompleted) {
      goto('/');
    }
  });

  // Time helpers
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

  function hoursBetween(start: string, end: string): string {
    let endMins = timeToMins(end);
    if (endMins === 1439) endMins = 1440;
    const diff = endMins - timeToMins(start);
    if (diff <= 0) return '0h';
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function snapToSlot(mins: number): number {
    return Math.round(mins / 30) * 30;
  }

  // Drag state
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
    dragging = { mode: 'slide', trackEl: track, slideOffset: clickMins - timeToMins(workStart) };
    track.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging-range');
  }

  function handleRangeMove(e: PointerEvent) {
    if (!dragging) return;
    const rect = dragging.trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const rawMins = pct * 1440;
    const curStart = timeToMins(workStart);
    const rawEnd = timeToMins(workEnd);
    const curEnd = rawEnd === 1439 ? 1440 : rawEnd;
    const duration = curEnd - curStart;

    if (dragging.mode === 'start') {
      const snapped = Math.max(0, Math.min(curEnd - 30, snapToSlot(rawMins)));
      workStart = minsToTime(snapped);
    } else if (dragging.mode === 'end') {
      const snapped = Math.max(curStart + 30, Math.min(1440, snapToSlot(rawMins)));
      workEnd = minsToTime(snapped);
    } else {
      const newStart = snapToSlot(rawMins - dragging.slideOffset);
      const maxStart = duration >= 1410 ? 0 : 1440 - duration;
      const clamped = Math.max(0, Math.min(maxStart, newStart));
      workStart = minsToTime(clamped);
      workEnd = minsToTime(clamped + duration);
    }
  }

  function handleRangeUp() {
    dragging = null;
    document.body.classList.remove('dragging-range');
  }

  // Validation
  let workHoursValid = $derived(
    timeToMins(workEnd) > timeToMins(workStart) &&
      timeToMins(workEnd) - timeToMins(workStart) >= 30,
  );
  let workHoursError = $derived(
    timeToMins(workEnd) <= timeToMins(workStart)
      ? 'End time must be after start time'
      : timeToMins(workEnd) - timeToMins(workStart) < 30
        ? 'Window must be at least 30 minutes'
        : '',
  );

  async function connectGoogle() {
    loading = true;
    try {
      await googleAuth('consent');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to connect Google', 'error');
      loading = false;
    }
  }

  async function checkCalendarConnection() {
    calendarChecking = true;
    calendarError = '';
    try {
      const status = await settings.getGoogleStatus();
      if (status.connected) {
        // Has refresh token — try discovering calendars
        let cals = await loadCalendars(true);
        if (cals.length === 0) {
          cals = await calendarsApi.discover();
        }
        calendarList = cals;
        calendarConnected = cals.length > 0;
        if (!calendarConnected) {
          calendarError = 'Connected to Google but no calendars found. Try reconnecting.';
        }
      } else {
        // No refresh token — need calendar permission
        calendarConnected = false;
      }
    } catch (err) {
      calendarConnected = false;
      calendarError = 'Could not check calendar access. Please try connecting below.';
    } finally {
      calendarChecking = false;
    }
  }

  // Track calendar changes locally — no API calls until completion
  let calendarChanges = $state<Map<string, { enabled?: boolean; mode?: CalendarMode }>>(new Map());

  function toggleCalendar(cal: CalendarType) {
    if (cal.isPrimary) return;
    const newEnabled = !cal.enabled;
    calendarList = calendarList.map((c) => (c.id === cal.id ? { ...c, enabled: newEnabled } : c));
    const existing = calendarChanges.get(cal.id) ?? {};
    calendarChanges.set(cal.id, { ...existing, enabled: newEnabled });
  }

  function setCalendarMode(cal: CalendarType, mode: CalendarMode) {
    calendarList = calendarList.map((c) => (c.id === cal.id ? { ...c, mode } : c));
    const existing = calendarChanges.get(cal.id) ?? {};
    calendarChanges.set(cal.id, { ...existing, mode });
  }

  $effect(() => {
    if (step === 2) {
      checkCalendarConnection();
    }
  });

  async function completeOnboarding() {
    loading = true;
    try {
      // Batch all changes in one go at the end

      // 1. Save working hours + browser timezone
      await settings.update({
        workingHours: { start: workStart, end: workEnd },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // 2. Apply calendar changes
      for (const [calId, changes] of calendarChanges) {
        await calendarsApi.update(calId, changes).catch(() => {});
      }

      // 3. Create first habit (if provided)
      if (habitName.trim()) {
        await habits
          .create({
            name: habitName.trim(),
            durationMin: habitDuration,
            durationMax: habitDuration,
            idealTime: habitIdealTime,
            windowStart: workStart,
            windowEnd: workEnd,
            ...getDaysForFreq(habitFrequency),
            priority: Priority.Medium,
            color: '#5BAD8A',
          })
          .catch(() => {});
      }

      // 4. Mark onboarding complete
      await settings.completeOnboarding();
      await checkAuth();
      await goto('/');
    } catch {
      await goto('/');
    } finally {
      loading = false;
    }
  }
</script>

<svelte:window onpointermove={handleRangeMove} onpointerup={handleRangeUp} />

<svelte:head>
  <title>{pageTitle('Get started')}</title>
</svelte:head>

<div class="onboarding-layout">
  <div class="onboarding-container">
    <div class="onboarding-step-indicator">
      {#each Array(TOTAL_STEPS) as _, i (i)}
        <div
          class="onboarding-dot"
          class:onboarding-dot-active={i + 1 === step}
          class:onboarding-dot-done={i + 1 < step}
        ></div>
      {/each}
    </div>

    <div class="onboarding-card">
      {#if step === 1}
        <div class="onboarding-step">
          <Sparkles size={36} class="onboarding-icon" />
          <h2 class="onboarding-title">Welcome to Fluxure</h2>
          <p class="onboarding-description">
            Let's set up your account in a few quick steps. We'll connect your calendar, configure
            your working hours, and help you create your first habit.
          </p>
          <div class="onboarding-actions">
            <button class="btn-primary" onclick={() => (step = 2)}>Get started</button>
          </div>
        </div>
      {:else if step === 2}
        <div class="onboarding-step">
          <Calendar size={36} class="onboarding-icon" />

          {#if calendarChecking}
            <h2 class="onboarding-title">Checking calendar access...</h2>
            <p class="onboarding-description">Looking for your Google calendars.</p>
          {:else if calendarConnected}
            <h2 class="onboarding-title">Your calendars</h2>
            <p class="onboarding-description">
              Choose which calendars Fluxure should read from when scheduling. Your primary calendar
              is always active.
            </p>

            <div class="calendar-list-onboarding">
              {#each calendarList as cal (cal.id)}
                <div class="calendar-row-onboarding" class:calendar-disabled={!cal.enabled}>
                  <div class="calendar-left">
                    <span class="calendar-dot" style:background-color={cal.color}></span>
                    <div class="calendar-text">
                      <span class="calendar-name">{cal.name}</span>
                      {#if cal.isPrimary}
                        <span class="calendar-badge">Primary · Always on</span>
                      {:else if cal.enabled}
                        <span class="calendar-mode-label">
                          {cal.mode === CalendarMode.Writable ? 'Writable' : 'Read-only'}
                        </span>
                      {/if}
                    </div>
                  </div>
                  <div class="calendar-controls">
                    {#if cal.enabled && !cal.isPrimary}
                      <select
                        class="mode-select"
                        value={cal.mode}
                        onchange={(e) =>
                          setCalendarMode(
                            cal,
                            (e.target as HTMLSelectElement).value as CalendarMode,
                          )}
                        aria-label="Mode for {cal.name}"
                      >
                        <option value={CalendarMode.Writable}>Writable</option>
                        <option value={CalendarMode.Locked}>Read-only</option>
                      </select>
                    {/if}
                    {#if cal.isPrimary}
                      <span class="calendar-always-on">Always on</span>
                    {:else}
                      <button
                        class="toggle-switch"
                        class:toggle-on={cal.enabled}
                        onclick={() => toggleCalendar(cal)}
                        role="switch"
                        aria-checked={cal.enabled}
                        aria-label="Toggle {cal.name}"
                      ></button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            <div class="calendar-mode-hint">
              <p><strong>Writable</strong> — Fluxure can create and move events on this calendar</p>
              <p>
                <strong>Read-only</strong> — Fluxure reads events but won't modify this calendar
              </p>
            </div>

            <div class="onboarding-actions">
              <button class="btn-primary" onclick={() => (step = 3)}>Continue</button>
            </div>
          {:else}
            <!-- Not connected or error -->
            {#if calendarError}
              <h2 class="onboarding-title">Calendar access needed</h2>
              <div class="calendar-error">
                <AlertCircle size={16} />
                <span>{calendarError}</span>
              </div>
            {:else}
              <h2 class="onboarding-title">Connect your calendar</h2>
              <p class="onboarding-description">
                Grant calendar access so Fluxure can find the best times for your habits, tasks, and
                focus time.
              </p>
            {/if}
            <div class="onboarding-actions">
              <button class="btn-primary" onclick={connectGoogle} disabled={loading}>
                {loading
                  ? 'Connecting...'
                  : calendarError
                    ? 'Reconnect Google Calendar'
                    : 'Connect Google Calendar'}
              </button>
            </div>
            <button class="onboarding-skip" onclick={() => (step = 3)}> Skip for now </button>
          {/if}
        </div>
      {:else if step === 3}
        <div class="onboarding-step">
          <Clock size={36} class="onboarding-icon" />
          <h2 class="onboarding-title">Working hours</h2>
          <p class="onboarding-description">
            Drag the handles or slide the bar to set your schedule.
          </p>

          <div class="onboarding-form">
            <div class="range-block">
              <div class="range-track">
                <div
                  class="range-fill"
                  role="presentation"
                  style="left: {timeToPercent(workStart)}%; width: {timeToPercent(workEnd) -
                    timeToPercent(workStart)}%"
                  onpointerdown={handleFillDown}
                >
                  <span class="range-duration">{hoursBetween(workStart, workEnd)}</span>
                </div>
                <div
                  class="range-handle"
                  role="slider"
                  tabindex="0"
                  aria-label="Working hours start"
                  aria-valuemin={0}
                  aria-valuemax={1440}
                  aria-valuenow={timeToMins(workStart)}
                  aria-valuetext={formatTimeLabel(workStart)}
                  style="left: {timeToPercent(workStart)}%"
                  onpointerdown={(e) => handleThumbDown(e, 'start')}
                >
                  <span class="range-time-label">{formatTimeLabel(workStart)}</span>
                </div>
                <div
                  class="range-handle"
                  role="slider"
                  tabindex="0"
                  aria-label="Working hours end"
                  aria-valuemin={0}
                  aria-valuemax={1440}
                  aria-valuenow={timeToMins(workEnd)}
                  aria-valuetext={formatTimeLabel(workEnd)}
                  style="left: {timeToPercent(workEnd)}%"
                  onpointerdown={(e) => handleThumbDown(e, 'end')}
                >
                  <span class="range-time-label">{formatTimeLabel(workEnd)}</span>
                </div>
              </div>
              <div class="range-labels">
                <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
              </div>
            </div>

            {#if workHoursError}
              <p class="hours-error">{workHoursError}</p>
            {/if}
          </div>

          <div class="onboarding-actions">
            <button class="btn-secondary" onclick={() => (step = 2)}>Back</button>
            <button class="btn-primary" onclick={() => (step = 4)} disabled={!workHoursValid}>
              Continue
            </button>
          </div>
        </div>
      {:else if step === 4}
        <div class="onboarding-step">
          <h2 class="onboarding-title">Create your first habit</h2>
          <p class="onboarding-description">What's something you'd like to do regularly?</p>

          <div class="onboarding-form">
            <div class="form-field">
              <input
                id="habit-name"
                class="form-input habit-name-input"
                type="text"
                bind:value={habitName}
                placeholder="e.g., Morning exercise, Read, Meditate"
                aria-label="Habit name"
              />
            </div>

            {#if habitName.trim()}
              <div class="habit-option-row habit-stagger-1">
                <span class="habit-option-label">How long?</span>
                <div class="habit-duration-control">
                  <input
                    type="range"
                    class="habit-range"
                    min="10"
                    max="120"
                    step="5"
                    bind:value={habitDuration}
                    aria-label="Duration"
                  />
                  <span class="habit-duration-value">{formatDuration(habitDuration)}</span>
                </div>
              </div>

              <div class="habit-option-row habit-stagger-2">
                <span class="habit-option-label">Best time?</span>
                <input
                  type="time"
                  class="form-input habit-time-input"
                  bind:value={habitIdealTime}
                  aria-label="Preferred time"
                />
              </div>

              <div class="habit-option-row habit-stagger-3">
                <span class="habit-option-label">How often?</span>
                <div class="habit-freq-pills">
                  <button
                    class="freq-pill"
                    class:freq-active={habitFrequency === 'daily'}
                    onclick={() => (habitFrequency = 'daily')}>Every day</button
                  >
                  <button
                    class="freq-pill"
                    class:freq-active={habitFrequency === 'weekdays'}
                    onclick={() => (habitFrequency = 'weekdays')}>Weekdays</button
                  >
                  <button
                    class="freq-pill"
                    class:freq-active={habitFrequency === 'weekends'}
                    onclick={() => (habitFrequency = 'weekends')}>Weekends</button
                  >
                </div>
              </div>

              <p class="habit-hint habit-stagger-4">
                You can fine-tune priority, color, and scheduling windows in the app.
              </p>
            {/if}
          </div>

          <div class="onboarding-actions">
            <button class="btn-secondary" onclick={() => (step = 3)}>Back</button>
            <button class="btn-primary" onclick={() => (step = 5)}>
              {habitName.trim() ? 'Continue' : 'Skip'}
            </button>
          </div>
        </div>
      {:else if step === 5}
        <div class="onboarding-step">
          <div class="onboarding-complete">
            <CheckCircle size={48} class="complete-icon" />
            <h2 class="onboarding-title">You're all set</h2>
            <p class="onboarding-description">
              Your account is ready. Fluxure will now optimize your schedule automatically.
            </p>
          </div>
          <div class="onboarding-actions">
            <button class="btn-primary" onclick={completeOnboarding} disabled={loading}>
              {loading ? 'Loading...' : 'Go to dashboard'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  :global(.onboarding-icon) {
    color: var(--color-accent);
    margin-bottom: var(--space-4);
  }

  .calendar-list-onboarding {
    display: flex;
    flex-direction: column;
    width: 100%;
    text-align: left;
    margin-bottom: var(--space-2);
  }

  .calendar-row-onboarding {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    transition: opacity var(--transition-fast);

    & + & {
      border-top: 1px solid var(--color-separator);
    }

    &.calendar-disabled {
      opacity: 0.4;
    }
  }

  .calendar-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
  }

  .calendar-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .calendar-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .calendar-mode-label {
    font-size: 0.625rem;
    color: var(--color-text-tertiary);
  }

  .calendar-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .calendar-name {
    font-size: 0.8125rem;
    color: var(--color-text);
    @include text-truncate;
  }

  .calendar-badge {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-accent);
    background: var(--color-accent-muted);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .calendar-always-on {
    font-size: 0.6875rem;
    color: var(--color-success);
    font-weight: 500;
    flex-shrink: 0;
  }

  .calendar-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-warning-muted);
    color: var(--color-warning);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    line-height: 1.4;
    margin-bottom: var(--space-4);
    text-align: left;

    :global(svg) {
      flex-shrink: 0;
      margin-top: 1px;
    }
  }

  .mode-select {
    appearance: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236B8898' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 4px center;
    background-size: 10px 8px;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: 0.6875rem;
    padding: 2px var(--space-4) 2px var(--space-2);
    height: 24px;
    cursor: pointer;
    outline: none;
    transition: border-color var(--transition-fast);

    &:focus {
      border-color: var(--color-accent);
    }
  }

  .calendar-mode-hint {
    text-align: left;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    line-height: 1.5;
    padding: var(--space-3);
    background: var(--color-surface-sunken);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2);

    p + p {
      margin-top: var(--space-1);
    }

    strong {
      color: var(--color-text-secondary);
      font-weight: 500;
    }
  }

  :global(body.dragging-range),
  :global(body.dragging-range *) {
    cursor: grabbing !important;
  }

  // ---- Draggable time range ----
  .range-block {
    @include flex-col(var(--space-1));
    user-select: none;
    padding-top: var(--space-6);
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
    background: var(--color-accent-muted);
    border: 1px solid var(--color-accent);
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
    color: var(--color-accent);
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
      border: 2px solid var(--color-accent);
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

  // ---- Habit step ----
  .habit-name-input {
    text-align: center;
    font-size: 1rem;
    font-weight: 500;
    height: 40px;
  }

  .habit-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) 0;
    gap: var(--space-3);
    border-top: 1px solid var(--color-separator);
    animation: fadeSlideIn 300ms ease-out both;
  }

  .habit-stagger-1 {
    animation-delay: 0ms;
  }
  .habit-stagger-2 {
    animation-delay: 80ms;
  }
  .habit-stagger-3 {
    animation-delay: 160ms;
  }
  .habit-stagger-4 {
    animation-delay: 240ms;
  }

  .habit-hint {
    text-align: center;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    padding: var(--space-2) 0;
    animation: fadeSlideIn 300ms ease-out both;
    border-top: none;
  }

  .habit-option-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    flex-shrink: 0;
    min-width: 80px;
  }

  .habit-duration-control {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    justify-content: flex-end;
  }

  .habit-range {
    width: 120px;
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

  .habit-duration-value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }

  .habit-time-input {
    width: 100px;
    text-align: center;
    font-size: 0.8125rem;
    height: 28px;
    padding: 0 var(--space-2);
  }

  .habit-freq-pills {
    display: flex;
    gap: 2px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-md);
    padding: 2px;
  }

  .freq-pill {
    padding: 3px var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-tertiary);
    font-family: inherit;
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;

    &:hover {
      color: var(--color-text-secondary);
    }
  }

  .freq-active {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .hours-error {
    text-align: center;
    font-size: 0.75rem;
    color: var(--color-danger);
    margin-top: var(--space-1);
  }
</style>
