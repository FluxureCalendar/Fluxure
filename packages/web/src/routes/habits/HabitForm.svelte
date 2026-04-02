<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import type { Habit, DayOfWeek } from '@fluxure/shared';
  import { SchedulingHours, Priority } from '@fluxure/shared';
  import { habits } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';
  import { getCachedSettings } from '$lib/cache.svelte';
  import TimeRangeSlider from '$lib/components/TimeRangeSlider.svelte';
  import DurationSlider from '$lib/components/DurationSlider.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import DayPicker from '$lib/components/DayPicker.svelte';

  import X from 'lucide-svelte/icons/x';

  let {
    open,
    habit,
    onclose,
    onsaved,
  }: {
    open: boolean;
    habit: Habit | null;
    onclose: () => void;
    onsaved?: () => void;
  } = $props();

  const isEdit = $derived(habit !== null);

  let name = $state('');
  let durationMin = $state(30);
  let durationMax = $state(30);
  let windowStart = $state('09:00');
  let windowEnd = $state('17:00');
  let idealTime = $state('09:00');
  let selectedDays = $state<DayOfWeek[]>(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  let schedulingHours = $state<SchedulingHours>(SchedulingHours.Working);
  let priority = $state<Priority>(Priority.Medium);
  let color = $state('#5BAD8A');
  let saving = $state(false);

  const tmpl = createSchedulingTemplateState();

  function fmtDuration(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function fmtTimeAmPm(t: string): string {
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr);
    const m = parseInt(mStr || '0');
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h >= 12 ? 'PM' : 'AM';
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  function minsToTime(mins: number): string {
    const c = Math.max(0, Math.min(1410, mins));
    return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
  }

  function timeToMins(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  // Keep durationMax >= durationMin
  $effect(() => {
    if (durationMax < durationMin) durationMax = durationMin;
  });

  // Compute ideal time bounds from the scheduling window
  // Convert a window-end time to minutes, treating "00:00" as end-of-day (1410 = 23:30)
  function windowEndToMins(t: string): number {
    const mins = timeToMins(t);
    return mins === 0 && t === '00:00' ? 1410 : mins;
  }

  let idealMinMins = $derived.by(() => {
    const config = getCachedSettings();
    if (schedulingHours === SchedulingHours.Custom) return timeToMins(windowStart);
    if (schedulingHours === SchedulingHours.Personal)
      return timeToMins(config?.settings?.personalHours?.start || '17:00');
    // Working or template
    const tmplMatch = tmpl.state.templates.find(
      (t) => `template:${t.id}` === tmpl.getDropdownValue(schedulingHours),
    );
    if (tmplMatch) return timeToMins(tmplMatch.startTime);
    return timeToMins(config?.settings?.workingHours?.start || '09:00');
  });

  let idealMaxMins = $derived.by(() => {
    const config = getCachedSettings();
    if (schedulingHours === SchedulingHours.Custom) return windowEndToMins(windowEnd);
    if (schedulingHours === SchedulingHours.Personal)
      return windowEndToMins(config?.settings?.personalHours?.end || '22:00');
    const tmplMatch = tmpl.state.templates.find(
      (t) => `template:${t.id}` === tmpl.getDropdownValue(schedulingHours),
    );
    if (tmplMatch) return windowEndToMins(tmplMatch.endTime);
    return windowEndToMins(config?.settings?.workingHours?.end || '17:00');
  });

  // Clamp ideal time to scheduling window
  $effect(() => {
    const minM = idealMinMins;
    const maxM = idealMaxMins;
    const cur = timeToMins(idealTime);
    if (cur < minM) idealTime = minsToTime(minM);
    else if (cur > maxM) idealTime = minsToTime(maxM);
  });

  let validationError = $derived(
    !name.trim()
      ? 'Name is required'
      : durationMin < 5
        ? 'Min duration must be at least 5 minutes'
        : durationMax < durationMin
          ? 'Max duration must be >= min duration'
          : selectedDays.length === 0
            ? 'Select at least one day'
            : '',
  );

  let isValid = $derived(!validationError);

  const colors = [
    '#5BAD8A',
    '#5B8DB8',
    '#8B7CB8',
    '#C4985A',
    '#C4645A',
    '#6BC49E',
    '#7BA8CC',
    '#A896CC',
  ];

  $effect(() => {
    if (open && habit) {
      name = habit.name;
      durationMin = habit.durationMin;
      durationMax = habit.durationMax;
      windowStart = habit.windowStart;
      windowEnd = habit.windowEnd;
      idealTime = habit.idealTime;
      selectedDays = habit.days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      schedulingHours = habit.schedulingHours;
      priority = habit.priority;
      color = habit.color || '#5BAD8A';
    } else if (open && !habit) {
      name = '';
      durationMin = 30;
      durationMax = 30;
      windowStart = '09:00';
      windowEnd = '17:00';
      idealTime = '09:00';
      selectedDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      schedulingHours = SchedulingHours.Working;
      priority = Priority.Medium;
      color = '#5BAD8A';
    }
  });

  onMount(() => {
    tmpl.load();
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;

    saving = true;
    try {
      const data = {
        name: name.trim(),
        durationMin,
        durationMax,
        windowStart,
        windowEnd,
        idealTime,
        days: [...selectedDays] as DayOfWeek[],
        schedulingHours,
        priority,
        color,
      };

      if (isEdit && habit) {
        await habits.update(habit.id, data);
        showToast('Habit updated', 'success');
      } else {
        await habits.create(data);
        showToast('Habit created', 'success');
      }
      onsaved?.();
      onclose();
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to save habit', 'error');
      }
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <div
    class="modal-overlay"
    role="presentation"
    onclick={onclose}
    onkeydown={(e) => {
      if (e.key === 'Escape') onclose();
    }}
    transition:fade={{ duration: 120 }}
  >
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      transition:fly={{ y: 12, duration: 180 }}
    >
      <div class="modal-header">
        <h2 class="modal-title">{isEdit ? 'Edit habit' : 'New habit'}</h2>
        <button class="modal-close" onclick={onclose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <form class="modal-body" onsubmit={handleSubmit}>
        <div class="form-field">
          <label class="form-label" for="habit-name">Name</label>
          <input
            id="habit-name"
            class="form-input"
            bind:value={name}
            required
            placeholder="e.g., Morning exercise"
          />
        </div>

        <DurationSlider bind:value={durationMin} label="Min duration" min={5} max={360} />
        <DurationSlider bind:value={durationMax} label="Max duration" min={5} max={360} />

        <div class="form-field">
          <label class="form-label" for="habit-schedule">Schedule during</label>
          <select
            id="habit-schedule"
            class="form-select"
            value={tmpl.getDropdownValue(schedulingHours)}
            onchange={(e) =>
              tmpl.handleDropdownChange((e.target as HTMLSelectElement).value, (hours) => {
                schedulingHours = hours;
              })}
          >
            <option value={SchedulingHours.Working}>Working hours</option>
            <option value={SchedulingHours.Personal}>Personal hours</option>
            <option value={SchedulingHours.Custom}>Custom</option>
            {#if tmpl.state.templates.length > 0}
              <optgroup label="Templates">
                {#each tmpl.state.templates as t (t.id)}
                  <option value="template:{t.id}">{t.name}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </div>

        {#if schedulingHours === SchedulingHours.Custom}
          <TimeRangeSlider bind:start={windowStart} bind:end={windowEnd} />
        {/if}

        <TimeSlider
          bind:value={idealTime}
          label="Ideal time"
          min={idealMinMins}
          max={idealMaxMins}
        />

        <div class="form-field">
          <span class="form-label">Days</span>
          <DayPicker bind:selected={selectedDays} />
        </div>

        <div class="form-field">
          <label class="form-label" for="habit-priority">Priority</label>
          <select id="habit-priority" class="form-select" bind:value={priority}>
            <option value={Priority.Critical}>Critical</option>
            <option value={Priority.High}>High</option>
            <option value={Priority.Medium}>Medium</option>
            <option value={Priority.Low}>Low</option>
          </select>
        </div>

        <div class="form-field">
          <span class="form-label" id="habit-color-label">Color</span>
          <div class="color-row" role="group" aria-labelledby="habit-color-label">
            {#each colors as c (c)}
              <button
                type="button"
                class="color-dot"
                class:color-active={color === c}
                style:background-color={c}
                onclick={() => (color = c)}
                aria-label="Select color"
              ></button>
            {/each}
          </div>
        </div>

        <div class="modal-footer">
          {#if validationError}
            <span class="validation-hint">{validationError}</span>
          {/if}
          <button type="button" class="btn-secondary" onclick={onclose}>Cancel</button>
          <button type="submit" class="btn-primary" disabled={saving || !isValid}>
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: $z-modal;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-overlay);
    backdrop-filter: blur(2px);
    padding: var(--space-4);
  }

  .modal-card {
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-5) var(--space-5) 0;
  }

  .modal-title {
    font-family: $font-body;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .modal-close {
    @include icon-btn(28px);
    color: var(--color-text-tertiary);
  }

  .modal-body {
    @include flex-col(var(--space-4));
    padding: var(--space-5);
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-separator);
  }

  .validation-hint {
    font-size: 0.6875rem;
    color: var(--color-danger);
    margin-right: auto;
  }

  .color-row {
    display: flex;
    gap: var(--space-2);
  }

  .color-dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    transition:
      border-color var(--transition-fast),
      transform 80ms ease;

    &:hover {
      transform: scale(1.15);
    }
  }

  .color-active {
    border-color: var(--color-text);
  }
</style>
