<script lang="ts">
  import type { SchedulingTemplate } from '$lib/api';
  import type { UserConfig } from '@fluxure/shared';
  import {
    SchedulingHours,
    COLOR_PALETTE,
    COLOR_NAMES,
    DEFAULT_HABIT_DURATION_MIN,
    DEFAULT_HABIT_DURATION_MAX,
    format as formatDate,
    subDays,
  } from '@fluxure/shared';
  import type { Habit, HabitCompletion, Calendar } from '@fluxure/shared';
  import { getScheduleDropdownValue } from '$lib/utils/scheduling-dropdown';
  import Flame from 'lucide-svelte/icons/flame';
  import CircleCheck from 'lucide-svelte/icons/circle-check';

  const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = {
    mon: 'M',
    tue: 'Tu',
    wed: 'W',
    thu: 'Th',
    fri: 'F',
    sat: 'Sa',
    sun: 'Su',
  };
  const DAY_FULL_LABELS: Record<string, string> = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    sun: 'Sun',
  };
  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const WEEKENDS = ['sat', 'sun'];

  const colorNames = COLOR_NAMES;

  interface Props {
    /** Habit to edit, or null for create mode */
    editingHabit: Habit | null;
    calendars: Calendar[];
    templates: SchedulingTemplate[];
    userSettings: UserConfig | null;
    submitting: boolean;
    /** Streak count for the editing habit */
    streak: number;
    /** Completions for the editing habit */
    completions: HabitCompletion[];
    onsubmit: (data: HabitFormData) => void;
    oncancel: () => void;
    onmarkcomplete: (habitId: string) => void;
  }

  export interface HabitFormData {
    name: string;
    priority: number;
    windowStart: string;
    windowEnd: string;
    idealTime: string;
    durationMin: number;
    durationMax: number;
    frequency: string;
    frequencyConfig: { days: string[] };
    schedulingHours: SchedulingHours;
    forced: boolean;
    autoDecline: boolean;
    notifications: boolean;
    skipBuffer: boolean;
    calendarId: string | undefined;
    color: string | undefined;
  }

  let {
    editingHabit,
    calendars,
    templates,
    userSettings,
    submitting,
    streak,
    completions: completionList,
    onsubmit,
    oncancel,
    onmarkcomplete,
  }: Props = $props();

  // --- Form state ---
  let formName = $state('');
  let formPriority = $state(3);
  let formWindowStart = $state('09:00');
  let formWindowEnd = $state('17:00');
  let formIdealTime = $state('10:00');
  let formDurationMin = $state(30);
  let formDurationMax = $state(60);
  let formDays = $state<string[]>([...WEEKDAYS]);
  let formSchedulingHours: SchedulingHours = $state(SchedulingHours.Working);
  let formForced = $state(false);
  let formAutoDecline = $state(false);
  let formNotifications = $state(false);
  let formSkipBuffer = $state(false);
  let formCalendarId = $state('');
  let formColor = $state('');
  let selectedTemplateId = $state<string | null>(null);
  let formError = $state('');

  // --- Helpers ---

  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sorted1 = [...a].sort();
    const sorted2 = [...b].sort();
    return sorted1.every((v, i) => v === sorted2[i]);
  }

  function getActivePreset(days: string[]): string {
    if (arraysEqual(days, [...ALL_DAYS])) return 'every-day';
    if (arraysEqual(days, WEEKDAYS)) return 'weekdays';
    if (arraysEqual(days, WEEKENDS)) return 'weekends';
    return 'custom';
  }

  function daysFromHabit(habit: Habit): string[] {
    if (habit.frequencyConfig?.days?.length) return [...habit.frequencyConfig.days];
    if (habit.frequency === 'daily') return [...ALL_DAYS];
    if (habit.frequency === 'weekly') return ['mon'];
    return [...WEEKDAYS];
  }

  function detectTemplateMatch(windowStart: string, windowEnd: string): string | null {
    const match = templates.find((t) => t.startTime === windowStart && t.endTime === windowEnd);
    return match?.id ?? null;
  }

  function applySchedulingPreset(value: SchedulingHours) {
    selectedTemplateId = null;
    const s = userSettings?.settings;
    if (value === SchedulingHours.Working && s) {
      formWindowStart = s.workingHours.start;
      formWindowEnd = s.workingHours.end;
    } else if (value === SchedulingHours.Personal && s) {
      formWindowStart = s.personalHours.start;
      formWindowEnd = s.personalHours.end;
    } else if (value === SchedulingHours.Custom) {
      formWindowStart = '00:00';
      formWindowEnd = '23:59';
    }
  }

  function handleScheduleDropdownChange(value: string) {
    if (value.startsWith('template:')) {
      const tmplId = value.slice('template:'.length);
      const tmpl = templates.find((t) => t.id === tmplId);
      if (tmpl) {
        selectedTemplateId = tmplId;
        formSchedulingHours = SchedulingHours.Custom;
        formWindowStart = tmpl.startTime;
        formWindowEnd = tmpl.endTime;
      }
    } else {
      formSchedulingHours = value as SchedulingHours;
      applySchedulingPreset(formSchedulingHours);
    }
  }

  function getLast7Days(): string[] {
    const days: string[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      days.push(formatDate(subDays(now, i), 'yyyy-MM-dd'));
    }
    return days;
  }

  function isDayCompleted(date: string): boolean {
    return completionList.some((c) => c.scheduledDate.startsWith(date));
  }

  function getDayLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'narrow' });
  }

  // --- Initialize form from editing habit or defaults ---

  function initForm(habit: Habit | null) {
    if (habit) {
      formName = habit.name;
      formPriority = habit.priority;
      formWindowStart = habit.windowStart;
      formWindowEnd = habit.windowEnd;
      formIdealTime = habit.idealTime;
      formDurationMin = habit.durationMin;
      formDurationMax = habit.durationMax;
      formDays = daysFromHabit(habit);
      formSchedulingHours = habit.schedulingHours;
      selectedTemplateId = detectTemplateMatch(habit.windowStart, habit.windowEnd);
      formForced = habit.forced;
      formAutoDecline = habit.autoDecline;
      formNotifications = habit.notifications ?? false;
      formSkipBuffer = habit.skipBuffer ?? false;
      formCalendarId = habit.calendarId ?? '';
      formColor = habit.color ?? '';
    } else {
      formName = '';
      formPriority = 3;
      formSchedulingHours = SchedulingHours.Working;
      selectedTemplateId = null;
      formForced = false;
      formAutoDecline = false;
      formNotifications = false;
      formSkipBuffer = false;
      formCalendarId =
        userSettings?.settings?.defaultHabitCalendarId ??
        calendars.find((c) => c.isPrimary)?.id ??
        calendars[0]?.id ??
        '';
      formColor = '';
      formIdealTime = '10:00';
      formDurationMin = 30;
      formDurationMax = 60;
      formDays = [...WEEKDAYS];
      applySchedulingPreset(formSchedulingHours);
    }
    formError = '';
  }

  // Re-initialize whenever the editingHabit prop changes
  $effect(() => {
    initForm(editingHabit);
  });

  // --- Submit ---

  function handleFormSubmit() {
    formError = '';
    if (formDays.length === 0) {
      formError = 'Select at least one day';
      return;
    }
    if (formDurationMin > formDurationMax) {
      formError = 'Min duration cannot exceed max';
      return;
    }
    if (formWindowStart >= formWindowEnd) {
      formError = 'Window start must be before end';
      return;
    }
    onsubmit({
      name: formName,
      priority: formPriority,
      windowStart: formWindowStart,
      windowEnd: formWindowEnd,
      idealTime: formIdealTime,
      durationMin: formDurationMin,
      durationMax: formDurationMax,
      frequency: 'daily',
      frequencyConfig: { days: [...formDays] },
      schedulingHours: formSchedulingHours,
      forced: formForced,
      autoDecline: formAutoDecline,
      notifications: formNotifications,
      skipBuffer: formSkipBuffer,
      calendarId: formCalendarId || undefined,
      color: formColor || undefined,
    });
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault();
    handleFormSubmit();
  }}
  class="panel-body"
>
  {#if formError}
    <div class="alert-error" id="habit-form-error" role="alert">{formError}</div>
  {/if}

  <div class="form-field">
    <label for="habit-name">Name</label>
    <input
      id="habit-name"
      type="text"
      bind:value={formName}
      required
      placeholder="e.g., Lunch Break"
      aria-describedby={formError ? 'habit-form-error' : undefined}
    />
  </div>

  <div class="form-field">
    <label for="habit-priority">Priority</label>
    <select id="habit-priority" bind:value={formPriority}>
      <option value={1}>P1 - Critical</option>
      <option value={2}>P2 - High</option>
      <option value={3}>P3 - Medium</option>
      <option value={4}>P4 - Low</option>
    </select>
  </div>

  <fieldset class="form-field">
    <legend class="form-label">Days</legend>
    <div class="day-presets">
      <button
        type="button"
        class="day-preset"
        class:day-preset--active={getActivePreset(formDays) === 'every-day'}
        aria-pressed={getActivePreset(formDays) === 'every-day'}
        onclick={() => {
          formDays = [...ALL_DAYS];
        }}>Every day</button
      >
      <span class="day-preset-sep">&middot;</span>
      <button
        type="button"
        class="day-preset"
        class:day-preset--active={getActivePreset(formDays) === 'weekdays'}
        aria-pressed={getActivePreset(formDays) === 'weekdays'}
        onclick={() => {
          formDays = [...WEEKDAYS];
        }}>Weekdays</button
      >
      <span class="day-preset-sep">&middot;</span>
      <button
        type="button"
        class="day-preset"
        class:day-preset--active={getActivePreset(formDays) === 'weekends'}
        aria-pressed={getActivePreset(formDays) === 'weekends'}
        onclick={() => {
          formDays = [...WEEKENDS];
        }}>Weekends</button
      >
      <span class="day-preset-sep">&middot;</span>
      <button
        type="button"
        class="day-preset"
        class:day-preset--active={getActivePreset(formDays) === 'custom'}
        aria-pressed={getActivePreset(formDays) === 'custom'}
        disabled={getActivePreset(formDays) === 'custom'}>Custom</button
      >
    </div>
    <div class="day-picker">
      {#each ALL_DAYS as day (day)}
        <button
          type="button"
          class="day-pill"
          class:day-pill--active={formDays.includes(day)}
          onclick={() => {
            if (formDays.includes(day)) {
              if (formDays.length > 1) {
                formDays = formDays.filter((d) => d !== day);
              }
            } else {
              formDays = [...formDays, day];
            }
          }}
          aria-label={DAY_FULL_LABELS[day]}
          aria-pressed={formDays.includes(day)}>{DAY_LABELS[day]}</button
        >
      {/each}
    </div>
  </fieldset>

  <fieldset class="form-section">
    <legend class="form-section-header">Duration</legend>
    <span class="form-helper"
      >How long this habit should be (the scheduler picks a duration in this range)</span
    >
    <div class="form-row">
      <div class="form-field">
        <label for="habit-dur-min">Minimum</label>
        <input
          id="habit-dur-min"
          type="number"
          bind:value={formDurationMin}
          min={DEFAULT_HABIT_DURATION_MIN}
          max={DEFAULT_HABIT_DURATION_MAX}
        />
      </div>
      <div class="form-field">
        <label for="habit-dur-max">Maximum</label>
        <input
          id="habit-dur-max"
          type="number"
          bind:value={formDurationMax}
          min={DEFAULT_HABIT_DURATION_MIN}
          max={DEFAULT_HABIT_DURATION_MAX}
        />
      </div>
    </div>
  </fieldset>

  <div class="form-field">
    <label for="habit-sched">Schedule during</label>
    <select
      id="habit-sched"
      value={getScheduleDropdownValue(formSchedulingHours, selectedTemplateId)}
      onchange={(e) => handleScheduleDropdownChange(e.currentTarget.value)}
    >
      <option value="working"
        >Work hours{userSettings?.settings
          ? ` (${userSettings.settings.workingHours.start}\u2013${userSettings.settings.workingHours.end})`
          : ''}</option
      >
      <option value="personal"
        >Personal hours{userSettings?.settings
          ? ` (${userSettings.settings.personalHours.start}\u2013${userSettings.settings.personalHours.end})`
          : ''}</option
      >
      <option value="custom">Anytime (custom)</option>
      {#if templates.length > 0}
        <optgroup label="Templates">
          {#each templates as tmpl (tmpl.id)}
            <option value="template:{tmpl.id}"
              >{tmpl.name} ({tmpl.startTime}\u2013{tmpl.endTime})</option
            >
          {/each}
        </optgroup>
      {/if}
    </select>
    <span class="form-helper">Preset fills the time range below</span>
  </div>

  <fieldset class="form-section">
    <legend class="form-section-header">Available time range</legend>
    <span class="form-helper">The time range this habit can be scheduled within</span>
    <div class="form-row">
      <div class="form-field">
        <label for="habit-win-start">Earliest</label>
        <input id="habit-win-start" type="time" bind:value={formWindowStart} />
      </div>
      <div class="form-field">
        <label for="habit-win-end">Latest</label>
        <input id="habit-win-end" type="time" bind:value={formWindowEnd} />
      </div>
    </div>
  </fieldset>

  <div class="form-field">
    <label for="habit-ideal">Preferred time</label>
    <input id="habit-ideal" type="time" bind:value={formIdealTime} />
    <span class="form-helper">The scheduler will try to schedule near this time</span>
  </div>

  {#if calendars.length > 0}
    <div class="form-field">
      <label for="habit-calendar">Calendar</label>
      <select id="habit-calendar" bind:value={formCalendarId}>
        {#each calendars as cal (cal.id)}
          <option value={cal.id}>{cal.isPrimary ? `Default - ${cal.name}` : cal.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <fieldset class="form-field">
    <legend class="form-label">Color</legend>
    <div class="color-picker">
      {#each COLOR_PALETTE as c (c)}
        <button
          type="button"
          class="color-swatch"
          class:color-swatch--active={formColor === c}
          style="background: {c};"
          onclick={() => {
            formColor = c;
          }}
          aria-label="Select {colorNames[c] ?? c}"
          aria-pressed={formColor === c}
        ></button>
      {/each}
      <button
        type="button"
        class="color-swatch color-swatch--none"
        class:color-swatch--active={!formColor}
        onclick={() => {
          formColor = '';
        }}
        aria-label="No color"
        aria-pressed={!formColor}>&#x2715;</button
      >
    </div>
  </fieldset>

  <div class="form-toggles">
    <label class="toggle-label">
      <input type="checkbox" bind:checked={formForced} />
      <span>Forced</span>
    </label>
    <label class="toggle-label">
      <input type="checkbox" bind:checked={formAutoDecline} />
      <span>Auto-decline</span>
    </label>
    <label class="toggle-label">
      <input type="checkbox" bind:checked={formNotifications} />
      <span>Notifications</span>
    </label>
    <label class="toggle-label">
      <input type="checkbox" bind:checked={formSkipBuffer} />
      <span>No buffer time</span>
    </label>
  </div>

  {#if editingHabit}
    <!-- Last 7 days completion -->
    <div class="completion-section">
      <div class="completion-header">
        <span class="completion-title">Last 7 Days</span>
        {#if streak > 0}
          <span class="streak-badge">
            <Flame size={14} strokeWidth={1.5} />
            {streak} day streak
          </span>
        {/if}
      </div>
      <div class="completion-dots">
        {#each getLast7Days() as day (day)}
          <div class="completion-day">
            <div class="completion-dot" class:completed={isDayCompleted(day)}></div>
            <span class="completion-day-label">{getDayLabel(day)}</span>
          </div>
        {/each}
      </div>
      <button
        type="button"
        class="btn-action"
        onclick={() => {
          onmarkcomplete(editingHabit!.id);
        }}
      >
        <CircleCheck size={16} strokeWidth={1.5} />
        Mark Complete Today
      </button>
    </div>
  {/if}

  <div class="panel-footer">
    <button type="submit" class="btn-save" disabled={submitting}>
      {submitting ? 'Saving...' : 'Save'}
    </button>
    <button type="button" class="btn-cancel" onclick={oncancel}> Cancel </button>
  </div>
</form>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .form-toggles {
    display: flex;
    gap: var(--space-6);
    padding: var(--space-2) 0;
    flex-wrap: wrap;
  }

  .streak-badge {
    @include badge;
    gap: 3px;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--color-warning-amber);
  }

  .completion-section {
    @include flex-col(var(--space-3));
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .completion-header {
    @include flex-between;
  }

  .completion-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .completion-dots {
    display: flex;
    gap: var(--space-3);
    justify-content: space-between;
  }

  .completion-day {
    @include flex-col(var(--space-1));
    align-items: center;
  }

  .completion-dot {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border);
    background: none;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);

    &.completed {
      background: var(--color-success);
      border-color: var(--color-success);
    }
  }

  .completion-day-label {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    font-weight: 500;
  }

  .form-section {
    border: none;
    padding: 0;
    margin: 0;
    @include flex-col(var(--space-2));

    &-header {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-text);
      padding: 0;
    }
  }

  .form-helper {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    line-height: 1.4;
  }

  .day-presets {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .day-preset {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: color var(--transition-fast);

    &:hover:not(:disabled) {
      color: var(--color-text);
    }

    &:disabled {
      cursor: default;
      opacity: 0.5;
    }

    &--active {
      color: var(--color-accent);
    }

    &-sep {
      font-size: 0.75rem;
      color: var(--color-border-strong);
      user-select: none;
    }
  }

  .day-picker {
    display: flex;
    gap: var(--space-1);
  }

  .day-pill {
    @include flex-center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast),
      border-color var(--transition-fast);

    &:hover {
      border-color: var(--color-border-strong);
      color: var(--color-text-secondary);
    }

    &--active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-text);

      &:hover {
        background: var(--color-accent-hover);
        border-color: var(--color-accent-hover);
        color: var(--color-accent-text);
      }
    }
  }
</style>
