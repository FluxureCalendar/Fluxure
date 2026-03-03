<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { page } from '$app/state';
  import { showSuccess } from '$lib/notifications.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { meetings as meetingsApi, billing as billingApi } from '$lib/api';
  import type { BillingStatus } from '$lib/api';
  import type { SmartMeeting } from '@fluxure/shared';
  import { isUnlimited } from '@fluxure/shared';
  import { loadCalendars, getCalendars } from '$lib/calendars.svelte';
  import {
    Frequency,
    CalendarMode,
    COLOR_PALETTE,
    COLOR_NAMES,
    DEFAULT_MEETING_DURATION,
    MAX_VISIBLE_ATTENDEES,
  } from '@fluxure/shared';
  import { formatDuration } from '$lib/utils/format';
  import SlideOverPanel from '$lib/components/SlideOverPanel.svelte';
  import KebabMenu from '$lib/components/KebabMenu.svelte';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Lock from 'lucide-svelte/icons/lock';
  import Users from 'lucide-svelte/icons/users';

  let meetingList = $state<SmartMeeting[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  let formName = $state('');
  let formPriority = $state(3);
  let formDuration = $state(DEFAULT_MEETING_DURATION);
  let formFrequency = $state('weekly');
  let formIdealTime = $state('10:00');
  let formWindowStart = $state('09:00');
  let formWindowEnd = $state('17:00');
  let formLocation = $state('');
  let formConferenceType = $state('none');
  let formAttendees = $state('');
  let formColor = $state('');
  let formCalendarId = $state('');
  let formSkipBuffer = $state(false);
  let calendarList = $derived(getCalendars());
  let billingStatus = $state<BillingStatus | null>(null);

  let meetingLimit = $derived(billingStatus?.limits.maxMeetings ?? null);
  let showUsageCounter = $derived(meetingLimit !== null && !isUnlimited(meetingLimit));
  let atLimit = $derived(showUsageCounter && meetingList.length >= (meetingLimit ?? 0));

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  const conferenceLabels: Record<string, string> = {
    zoom: 'Zoom',
    meet: 'Meet',
    teams: 'Teams',
    none: 'None',
  };

  const colorNames = COLOR_NAMES;

  function getInitials(email: string): string {
    const name = email.split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function resetForm() {
    formName = '';
    formPriority = 3;
    formDuration = DEFAULT_MEETING_DURATION;
    formFrequency = 'weekly';
    formIdealTime = '10:00';
    formWindowStart = '09:00';
    formWindowEnd = '17:00';
    formLocation = '';
    formConferenceType = 'none';
    formAttendees = '';
    formColor = '';
    formCalendarId =
      calendarList.find((c) => c.isPrimary && c.mode === CalendarMode.Writable && c.enabled)?.id ??
      calendarList.find((c) => c.mode === CalendarMode.Writable && c.enabled)?.id ??
      '';
    formSkipBuffer = false;
    editingId = null;
  }

  function openAddForm() {
    resetForm();
    showPanel = true;
  }

  function openEditForm(meeting: SmartMeeting) {
    editingId = meeting.id;
    formName = meeting.name;
    formPriority = meeting.priority;
    formDuration = meeting.duration;
    formFrequency = meeting.frequency;
    formIdealTime = meeting.idealTime ?? '';
    formWindowStart = meeting.windowStart ?? '';
    formWindowEnd = meeting.windowEnd ?? '';
    formLocation = meeting.location;
    formConferenceType = meeting.conferenceType;
    formAttendees = meeting.attendees.join(', ');
    formColor = meeting.color ?? '';
    formCalendarId = meeting.calendarId ?? '';
    formSkipBuffer = meeting.skipBuffer ?? false;
    showPanel = true;
  }

  function closePanel() {
    showPanel = false;
    resetForm();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (menuOpenId) {
        menuOpenId = null;
        confirmingDeleteId = null;
        return;
      }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) {
      menuOpenId = null;
      confirmingDeleteId = null;
    }
  }

  async function handleSubmit() {
    submitting = true;
    error = '';
    const meetingData = {
      name: formName.trim(),
      priority: formPriority,
      duration: formDuration,
      frequency: formFrequency as Frequency,
      idealTime: formIdealTime,
      windowStart: formWindowStart,
      windowEnd: formWindowEnd,
      location: formLocation.trim(),
      conferenceType: formConferenceType.trim(),
      attendees: formAttendees
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean),
      color: formColor || undefined,
      calendarId: formCalendarId || undefined,
      skipBuffer: formSkipBuffer,
    };

    try {
      if (editingId) {
        const updated = await meetingsApi.update(editingId, meetingData);
        meetingList = meetingList.map((m) => (m.id === editingId ? updated : m));
      } else {
        const created = await meetingsApi.create(meetingData);
        meetingList = [...meetingList, created];
      }
      showSuccess(editingId ? 'Meeting updated successfully.' : 'Meeting created successfully.');
      closePanel();
    } catch (err) {
      if (err instanceof TypeError) {
        error = "You're offline — check your connection";
      } else {
        error = err instanceof Error ? err.message : 'Failed to save. Please try again.';
      }
    } finally {
      submitting = false;
    }
  }

  async function deleteMeeting(id: string) {
    try {
      await meetingsApi.delete(id);
      meetingList = meetingList.filter((m) => m.id !== id);
      showSuccess('Meeting deleted successfully.');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete meeting. Please try again.';
    }
    confirmingDeleteId = null;
    menuOpenId = null;
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await meetingsApi.list();
      meetingList = list;
    } catch (err) {
      if (err instanceof TypeError) {
        error = "You're offline — check your connection";
      } else {
        error = 'Failed to load data from API. Showing cached data.';
      }
    } finally {
      loading = false;
    }
    billingApi
      .status()
      .then((s) => {
        billingStatus = s;
      })
      .catch(() => {});

    loadCalendars();

    // Deep-link: open edit panel from ?edit=<id> query param
    const editId = untrack(() => page.url.searchParams.get('edit'));
    if (editId) {
      const meeting = meetingList.find((m) => m.id === editId);
      if (meeting) {
        await tick();
        openEditForm(meeting);
      }
      const url = new URL(untrack(() => page.url));
      url.searchParams.delete('edit');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Meetings')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="page-wrapper">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Meetings</h1>
    <div class="header-actions">
      {#if showUsageCounter}
        <span class="usage-counter" class:usage-counter--warn={atLimit}>
          {meetingList.length} of {meetingLimit}
        </span>
      {/if}
      <button
        onclick={openAddForm}
        class="btn-accent-pill"
        aria-expanded={showPanel}
        aria-controls="meetings-panel"
      >
        <Plus size={16} strokeWidth={1.5} />
        Add Meeting
      </button>
    </div>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}

  {#if loading}
    <div class="loading-container" role="status" aria-live="polite">
      <p>Loading...</p>
    </div>
  {:else if meetingList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Users size={48} strokeWidth={1.5} aria-hidden="true" />
      <h2 class="empty-state-title">No meetings yet</h2>
      <p class="empty-state-desc">Create your first smart meeting to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-state-btn">
        <Plus size={16} strokeWidth={1.5} />
        Add Meeting
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Meetings">
      <!-- Table Header -->
      <div role="rowgroup">
        <div class="table-header table-grid" role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Priority</span>
          <span role="columnheader">Duration</span>
          <span role="columnheader" class="hide-mobile">Frequency</span>
          <span role="columnheader" class="hide-mobile">Conference</span>
          <span role="columnheader" class="hide-mobile">Attendees</span>
          <span role="columnheader" aria-label="Actions"></span>
        </div>
      </div>

      <!-- Table Rows -->
      <div role="rowgroup">
        {#each meetingList as meeting (meeting.id)}
          <div class="table-row table-grid" class:frozen={!meeting.enabled} role="row">
            <span role="cell" class="name-cell">
              <button
                class="name-btn"
                onclick={() => openEditForm(meeting)}
                tabindex={!meeting.enabled ? -1 : undefined}>{meeting.name}</button
              >
              {#if !meeting.enabled}
                <span class="frozen-badge" title="Upgrade to Pro to unfreeze">
                  <Lock size={12} strokeWidth={1.5} />
                  Frozen
                </span>
              {/if}
            </span>
            <span role="cell">
              <span class="priority-badge priority-{meeting.priority}"
                >{priorityLabels[meeting.priority]}</span
              >
            </span>
            <span role="cell" class="font-mono cell-secondary"
              >{formatDuration(meeting.duration)}</span
            >
            <span role="cell" class="cell-frequency hide-mobile">{meeting.frequency}</span>
            <span role="cell" class="hide-mobile">
              {#if meeting.conferenceType && meeting.conferenceType !== 'none'}
                <span class="conference-badge"
                  >{conferenceLabels[meeting.conferenceType] || meeting.conferenceType}</span
                >
              {:else}
                <span class="cell-placeholder">--</span>
              {/if}
            </span>
            <span role="cell" class="cell-attendees hide-mobile">
              {#if meeting.attendees.length > 0}
                <div class="avatar-group">
                  {#each meeting.attendees.slice(0, MAX_VISIBLE_ATTENDEES) as email (email)}
                    <div class="avatar-circle" title={email}>{getInitials(email)}</div>
                  {/each}
                  {#if meeting.attendees.length > 3}
                    <div class="avatar-circle avatar-overflow">+{meeting.attendees.length - 3}</div>
                  {/if}
                </div>
              {:else}
                <span class="cell-placeholder">--</span>
              {/if}
            </span>
            <span role="cell">
              <KebabMenu
                open={menuOpenId === meeting.id}
                ontoggle={(open) => {
                  confirmingDeleteId = null;
                  menuOpenId = open ? meeting.id : null;
                }}
                itemName={meeting.name}
              >
                {#if confirmingDeleteId === meeting.id}
                  <span class="confirm-text" role="none">Delete this meeting?</span>
                  <button
                    class="kebab-menu-item kebab-menu-item--danger"
                    role="menuitem"
                    onclick={() => deleteMeeting(meeting.id)}
                  >
                    Confirm
                  </button>
                  <button
                    class="kebab-menu-item"
                    role="menuitem"
                    onclick={() => {
                      confirmingDeleteId = null;
                    }}
                  >
                    Cancel
                  </button>
                {:else}
                  <button
                    class="kebab-menu-item"
                    role="menuitem"
                    onclick={() => {
                      menuOpenId = null;
                      openEditForm(meeting);
                    }}
                  >
                    <Pencil size={15} strokeWidth={1.5} />
                    Edit
                  </button>
                  <button
                    class="kebab-menu-item kebab-menu-item--danger"
                    role="menuitem"
                    onclick={() => {
                      confirmingDeleteId = meeting.id;
                    }}
                  >
                    <Trash2 size={15} strokeWidth={1.5} />
                    Delete
                  </button>
                {/if}
              </KebabMenu>
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Slide-over Panel -->
<SlideOverPanel
  open={showPanel}
  title={editingId ? 'Edit Meeting' : 'Add Meeting'}
  onclose={closePanel}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
    class="panel-body"
  >
    <div class="form-field">
      <label for="mtg-name">Name</label>
      <input
        id="mtg-name"
        type="text"
        bind:value={formName}
        required
        placeholder="e.g., Team Standup"
      />
    </div>

    <div class="form-field">
      <label for="mtg-priority">Priority</label>
      <select id="mtg-priority" bind:value={formPriority}>
        <option value={1}>P1 - Critical</option>
        <option value={2}>P2 - High</option>
        <option value={3}>P3 - Medium</option>
        <option value={4}>P4 - Low</option>
      </select>
    </div>

    <div class="form-row">
      <div class="form-field">
        <label for="mtg-dur">Duration (min)</label>
        <input id="mtg-dur" type="number" bind:value={formDuration} min="5" />
      </div>
      <div class="form-field">
        <label for="mtg-freq">Frequency</label>
        <select id="mtg-freq" bind:value={formFrequency}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
    </div>

    <div class="form-field">
      <label for="mtg-ideal">Ideal Time</label>
      <input id="mtg-ideal" type="time" bind:value={formIdealTime} />
    </div>

    <div class="form-row">
      <div class="form-field">
        <label for="mtg-win-start">Window Start</label>
        <input id="mtg-win-start" type="time" bind:value={formWindowStart} />
      </div>
      <div class="form-field">
        <label for="mtg-win-end">Window End</label>
        <input id="mtg-win-end" type="time" bind:value={formWindowEnd} />
      </div>
    </div>

    <div class="form-field">
      <label for="mtg-conf">Conference Type</label>
      <select id="mtg-conf" bind:value={formConferenceType}>
        <option value="none">None</option>
        <option value="zoom">Zoom</option>
        <option value="meet">Google Meet</option>
        <option value="teams">Microsoft Teams</option>
      </select>
    </div>

    <div class="form-field">
      <label for="mtg-location">Location</label>
      <input
        id="mtg-location"
        type="text"
        bind:value={formLocation}
        placeholder="e.g., Conference Room A"
      />
    </div>

    <div class="form-field">
      <label for="mtg-attendees">Attendees (comma-separated emails)</label>
      <input
        id="mtg-attendees"
        type="text"
        bind:value={formAttendees}
        placeholder="e.g., alice@example.com, bob@example.com"
      />
    </div>

    {#if calendarList.some((c) => c.mode === CalendarMode.Writable && c.enabled)}
      <div class="form-field">
        <label for="mtg-calendar">Calendar</label>
        <select id="mtg-calendar" bind:value={formCalendarId}>
          {#each calendarList.filter((c) => c.mode === CalendarMode.Writable && c.enabled) as cal (cal.id)}
            <option value={cal.id}>{cal.isPrimary ? `Default - ${cal.name}` : cal.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <fieldset class="form-field color-fieldset">
      <legend>Color</legend>
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
            aria-label="Select color {colorNames[c] ?? c}"
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

    <div class="form-field">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={formSkipBuffer} />
        <span>Skip buffer time for this meeting</span>
      </label>
    </div>

    <div class="panel-footer">
      <button type="submit" class="btn-save" disabled={submitting}>
        {submitting ? 'Saving...' : 'Save'}
      </button>
      <button type="button" class="btn-cancel" onclick={closePanel}> Cancel </button>
    </div>
  </form>
</SlideOverPanel>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .table-grid {
    grid-template-columns: 1fr 70px 80px 90px 100px 120px 40px;
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    overflow: hidden;
  }

  .name-btn {
    background: none;
    border: none;
    padding: 0;
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;

    &:hover {
      color: var(--color-accent);
    }
  }

  .cell-secondary {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .cell-frequency {
    color: var(--color-text-secondary);
    text-transform: capitalize;
    font-size: 0.8125rem;
  }

  .cell-placeholder {
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .cell-attendees {
    display: flex;
    align-items: center;
  }

  .conference-badge {
    @include badge(var(--color-meeting-bg), var(--color-meeting-border));
    font-weight: 500;
  }

  .avatar-group {
    display: flex;
    align-items: center;
  }

  .avatar-circle {
    @include flex-center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: var(--color-accent-muted);
    color: var(--color-accent);
    font-size: 0.625rem;
    font-weight: 600;
    border: 2px solid var(--color-surface);
    margin-left: -6px;

    &:first-child {
      margin-left: 0;
    }
  }

  .avatar-overflow {
    background: var(--color-surface-active);
    color: var(--color-text-secondary);
  }

  .color-fieldset {
    border: none;
    padding: 0;
    margin: 0;

    legend {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      margin-bottom: var(--space-1);
    }
  }

  @include mobile {
    .table-grid {
      grid-template-columns: 1fr 60px 70px 40px;
    }

    :global(.hide-mobile) {
      display: none;
    }
  }
</style>
