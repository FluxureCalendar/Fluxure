<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import type {
    SmartMeeting,
    CreateMeetingRequest,
    ConferenceType,
    DayOfWeek,
  } from '@fluxure/shared';
  import { Frequency, Priority } from '@fluxure/shared';
  import { meetings } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import TimeRangeSlider from '$lib/components/TimeRangeSlider.svelte';
  import DurationSlider from '$lib/components/DurationSlider.svelte';
  import TimeSlider from '$lib/components/TimeSlider.svelte';
  import DayPicker from '$lib/components/DayPicker.svelte';

  import X from 'lucide-svelte/icons/x';

  let {
    open,
    meeting,
    onclose,
    onsaved,
  }: {
    open: boolean;
    meeting: SmartMeeting | null;
    onclose: () => void;
    onsaved?: () => void;
  } = $props();

  const isEdit = $derived(meeting !== null);

  let name = $state('');
  let duration = $state(30);
  let windowStart = $state('09:00');
  let windowEnd = $state('17:00');
  let idealTime = $state('10:00');
  let frequency = $state<Frequency>(Frequency.Weekly);
  let selectedDays = $state<DayOfWeek[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  let priority = $state<Priority>(Priority.Medium);
  let conferenceType = $state<ConferenceType>('none');
  let location = $state('');
  let attendees = $state('');
  let color = $state('#5B8DB8');
  let saving = $state(false);

  function fmtTimeAmPm(t: string): string {
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr);
    const m = parseInt(mStr || '0');
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h >= 12 ? 'PM' : 'AM';
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  function timeToMins(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function minsToTime(mins: number): string {
    const c = Math.max(0, Math.min(1410, mins));
    return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
  }

  // Convert a window-end time to minutes, treating "00:00" as end-of-day (1410 = 23:30)
  function windowEndToMins(t: string): number {
    const mins = timeToMins(t);
    return mins === 0 && t === '00:00' ? 1410 : mins;
  }

  // Clamp ideal time to window
  $effect(() => {
    const minM = timeToMins(windowStart);
    const maxM = windowEndToMins(windowEnd);
    const cur = timeToMins(idealTime);
    if (cur < minM) idealTime = minsToTime(minM);
    else if (cur > maxM) idealTime = minsToTime(maxM);
  });

  let validationError = $derived(
    !name.trim()
      ? 'Name is required'
      : duration < 15
        ? 'Duration must be at least 15 minutes'
        : selectedDays.length === 0
          ? 'Select at least one day'
          : '',
  );

  let isValid = $derived(!validationError);

  const colors = [
    '#5B8DB8',
    '#5BAD8A',
    '#8B7CB8',
    '#C4985A',
    '#C4645A',
    '#6BC49E',
    '#7BA8CC',
    '#A896CC',
  ];

  $effect(() => {
    if (open && meeting) {
      name = meeting.name;
      duration = meeting.duration;
      windowStart = meeting.windowStart || '09:00';
      windowEnd = meeting.windowEnd || '17:00';
      idealTime = meeting.idealTime || '10:00';
      frequency = meeting.frequency;
      selectedDays = meeting.frequencyConfig?.days || ['mon', 'tue', 'wed', 'thu', 'fri'];
      priority = meeting.priority;
      conferenceType = (meeting.conferenceType || 'none') as ConferenceType;
      location = meeting.location || '';
      attendees = meeting.attendees.join(', ');
      color = meeting.color || '#5B8DB8';
    } else if (open && !meeting) {
      name = '';
      duration = 30;
      windowStart = '09:00';
      windowEnd = '17:00';
      idealTime = '10:00';
      frequency = Frequency.Weekly;
      selectedDays = ['mon', 'tue', 'wed', 'thu', 'fri'];
      priority = Priority.Medium;
      conferenceType = 'none' as ConferenceType;
      location = '';
      attendees = '';
      color = '#5B8DB8';
    }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;

    saving = true;
    try {
      const actualFrequency = frequency;

      const parsedAttendees = attendees
        .split(/[,;\s]+/)
        .map((a) => a.trim())
        .filter((a) => a.includes('@'));

      const data = {
        name: name.trim(),
        duration,
        frequency: actualFrequency,
        frequencyConfig: { days: [...selectedDays] },
        idealTime,
        windowStart,
        windowEnd,
        priority,
        conferenceType,
        location: location.trim(),
        attendees: parsedAttendees,
        color,
      };

      if (isEdit && meeting) {
        await meetings.update(meeting.id, data);
        showToast('Meeting updated', 'success');
      } else {
        await meetings.create(data);
        showToast('Meeting created', 'success');
      }
      onsaved?.();
      onclose();
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to save meeting', 'error');
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
    transition:fade={{ duration: 120 }}
  >
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') onclose();
      }}
      transition:fly={{ y: 12, duration: 180 }}
    >
      <div class="modal-header">
        <h2 class="modal-title">{isEdit ? 'Edit meeting' : 'New meeting'}</h2>
        <button class="modal-close" onclick={onclose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <form class="modal-body" onsubmit={handleSubmit}>
        <div class="form-field">
          <label class="form-label" for="meeting-name">Name</label>
          <input
            id="meeting-name"
            class="form-input"
            bind:value={name}
            required
            placeholder="e.g., Weekly standup"
          />
        </div>

        <DurationSlider bind:value={duration} label="Duration" min={15} max={240} />

        <div class="form-field">
          <label class="form-label" for="meeting-frequency">Frequency</label>
          <select id="meeting-frequency" class="form-select" bind:value={frequency}>
            <option value={Frequency.Daily}>Daily</option>
            <option value={Frequency.Weekly}>Weekly</option>
            <option value={Frequency.Monthly}>Monthly</option>
          </select>
        </div>

        <div class="form-field">
          <span class="form-label">Days</span>
          <DayPicker bind:selected={selectedDays} />
        </div>

        <TimeRangeSlider bind:start={windowStart} bind:end={windowEnd} />
        <TimeSlider
          bind:value={idealTime}
          label="Ideal time"
          min={timeToMins(windowStart)}
          max={windowEndToMins(windowEnd)}
        />

        <div class="form-field">
          <label class="form-label" for="meeting-priority">Priority</label>
          <select id="meeting-priority" class="form-select" bind:value={priority}>
            <option value={Priority.Critical}>Critical</option>
            <option value={Priority.High}>High</option>
            <option value={Priority.Medium}>Medium</option>
            <option value={Priority.Low}>Low</option>
          </select>
        </div>

        <div class="form-field">
          <label class="form-label" for="meeting-conference">Conference</label>
          <select id="meeting-conference" class="form-select" bind:value={conferenceType}>
            <option value="none">None</option>
            <option value="google_meet">Google Meet</option>
            <option value="zoom">Zoom</option>
            <option value="teams">Microsoft Teams</option>
          </select>
        </div>

        <div class="form-field">
          <label class="form-label" for="meeting-location">Location</label>
          <input
            id="meeting-location"
            class="form-input"
            bind:value={location}
            placeholder="Optional room or address"
          />
        </div>

        <div class="form-field">
          <label class="form-label" for="meeting-attendees">Attendees</label>
          <input
            id="meeting-attendees"
            class="form-input"
            bind:value={attendees}
            placeholder="email@example.com, another@example.com"
          />
          <span class="form-hint">Comma-separated email addresses</span>
        </div>

        <div class="form-field">
          <span class="form-label" id="meeting-color-label">Color</span>
          <div class="color-row" role="group" aria-labelledby="meeting-color-label">
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

  .form-hint {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    margin-top: calc(-1 * var(--space-2));
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
