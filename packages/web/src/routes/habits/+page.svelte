<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { page } from '$app/state';
  import { showSuccess } from '$lib/notifications.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import {
    habits as habitsApi,
    settings as settingsApi,
    billing as billingApi,
    ApiError,
  } from '$lib/api';
  import type { BillingStatus } from '$lib/api';
  import { isUnlimited } from '@fluxure/shared';
  import type { UserConfig } from '@fluxure/shared';
  import { getCachedSettings, setCachedSettings } from '$lib/cache.svelte';
  import { loadCalendars, getCalendars } from '$lib/calendars.svelte';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';
  import { Frequency, CalendarMode, SchedulingHours, format as formatDate } from '@fluxure/shared';
  import type { Habit, HabitCompletion } from '@fluxure/shared';
  import SlideOverPanel from '$lib/components/SlideOverPanel.svelte';
  import KebabMenu from '$lib/components/KebabMenu.svelte';
  import HabitForm from './HabitForm.svelte';
  import type { HabitFormData } from './HabitForm.svelte';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Lock from 'lucide-svelte/icons/lock';
  import Bell from 'lucide-svelte/icons/bell';
  import BellOff from 'lucide-svelte/icons/bell-off';
  import Repeat from 'lucide-svelte/icons/repeat';
  import ToggleLeft from 'lucide-svelte/icons/toggle-left';
  import ToggleRight from 'lucide-svelte/icons/toggle-right';
  import Flame from 'lucide-svelte/icons/flame';
  import Link2 from 'lucide-svelte/icons/link-2';
  import CircleCheck from 'lucide-svelte/icons/circle-check';

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

  let habitList = $state<Habit[]>([]);
  let showPanel = $state(false);
  let editingHabit = $state<Habit | null>(null);
  let loading = $state(true);
  let error = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let userSettings = $state<UserConfig | null>(null);
  let billingStatus = $state<BillingStatus | null>(null);
  const templateState = createSchedulingTemplateState();
  let calendarList = $derived(getCalendars());
  let schedulingTemplates = $derived(templateState.state.templates);

  let habitLimit = $derived(billingStatus?.limits.maxHabits ?? null);
  let showUsageCounter = $derived(habitLimit !== null && !isUnlimited(habitLimit));
  let atLimit = $derived(showUsageCounter && habitList.length >= (habitLimit ?? 0));

  let streaks = $state<Record<string, number>>({});
  let completions = $state<Record<string, HabitCompletion[]>>({});

  function getTodayDateString(): string {
    return formatDate(new Date(), 'yyyy-MM-dd');
  }

  function getParentName(dependsOn: string | null | undefined): string {
    if (!dependsOn) return '';
    const parent = habitList.find((h) => h.id === dependsOn);
    return parent?.name || 'Unknown';
  }

  async function loadStreaksAndCompletions() {
    try {
      const bulkStatus = await habitsApi.getBulkStatus();
      let newStreaks: Record<string, number> = {};
      let newCompletions: Record<string, HabitCompletion[]> = {};
      for (const [id, status] of Object.entries(bulkStatus)) {
        newStreaks[id] = status.streak;
        newCompletions[id] = status.completions;
      }
      streaks = newStreaks;
      completions = newCompletions;
    } catch {
      const results = await Promise.all(
        habitList.map(async (habit) => {
          try {
            const [streakData, completionData] = await Promise.all([
              habitsApi.getStreak(habit.id),
              habitsApi.getCompletions(habit.id),
            ]);
            return { id: habit.id, streak: streakData.currentStreak, completions: completionData };
          } catch {
            return null;
          }
        }),
      );
      let newStreaks = { ...streaks };
      let newCompletions = { ...completions };
      for (const result of results) {
        if (result) {
          newStreaks = { ...newStreaks, [result.id]: result.streak };
          newCompletions = { ...newCompletions, [result.id]: result.completions };
        }
      }
      streaks = newStreaks;
      completions = newCompletions;
    }
  }

  async function markComplete(habitId: string) {
    const today = getTodayDateString();
    try {
      await habitsApi.markComplete(habitId, today);
      const [streakData, completionData] = await Promise.all([
        habitsApi.getStreak(habitId),
        habitsApi.getCompletions(habitId),
      ]);
      streaks = { ...streaks, [habitId]: streakData.currentStreak };
      completions = { ...completions, [habitId]: completionData };
      showSuccess('Habit marked complete.');
    } catch (err) {
      if (err instanceof TypeError) {
        const now = new Date().toISOString();
        const existing = completions[habitId] || [];
        completions = {
          ...completions,
          [habitId]: [
            ...existing,
            { id: crypto.randomUUID(), habitId, scheduledDate: today, completedAt: now },
          ],
        };
        streaks = { ...streaks, [habitId]: (streaks[habitId] || 0) + 1 };
        showSuccess('Habit marked complete (offline).');
      } else {
        error = err instanceof Error ? err.message : 'Failed to mark complete.';
      }
    }
  }

  function openAddForm() {
    editingHabit = null;
    showPanel = true;
  }

  function openEditForm(habit: Habit) {
    editingHabit = habit;
    showPanel = true;
  }

  function closePanel() {
    showPanel = false;
    editingHabit = null;
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

  async function handleFormSubmit(data: HabitFormData) {
    error = '';
    submitting = true;
    const habitData = {
      ...data,
      name: data.name.trim(),
      frequency: Frequency.Daily,
    };

    try {
      if (editingHabit) {
        const updated = await habitsApi.update(editingHabit.id, habitData);
        habitList = habitList.map((h) => (h.id === editingHabit!.id ? updated : h));
      } else {
        const created = await habitsApi.create(habitData);
        habitList = [...habitList, created];
      }
      showSuccess(editingHabit ? 'Habit updated successfully.' : 'Habit created successfully.');
      closePanel();
    } catch (err) {
      if (err instanceof TypeError) {
        if (editingHabit) {
          habitList = habitList.map((h) =>
            h.id === editingHabit!.id ? { ...h, ...habitData } : h,
          ) as Habit[];
          showSuccess('Habit updated (offline).');
        } else {
          const now = new Date().toISOString();
          habitList = [
            ...habitList,
            {
              id: crypto.randomUUID(),
              ...habitData,
              priority: habitData.priority ?? 3,
              frequencyConfig: habitData.frequencyConfig ?? {},
              schedulingHours: habitData.schedulingHours ?? SchedulingHours.Working,
              forced: habitData.forced ?? false,
              autoDecline: habitData.autoDecline ?? false,
              dependsOn: null,
              skipBuffer: habitData.skipBuffer ?? false,
              notifications: habitData.notifications ?? false,
              enabled: true,
              createdAt: now,
              updatedAt: now,
            } satisfies Habit,
          ];
          showSuccess('Habit created (offline).');
        }
        closePanel();
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    } finally {
      submitting = false;
    }
  }

  async function toggleNotifications(habit: Habit) {
    const prevNotifications = habit.notifications;
    habitList = habitList.map((h) =>
      h.id === habit.id ? { ...h, notifications: !h.notifications } : h,
    );
    try {
      const updated = await habitsApi.update(habit.id, { notifications: !prevNotifications });
      habitList = habitList.map((h) => (h.id === habit.id ? updated : h));
    } catch (err) {
      if (!(err instanceof TypeError)) {
        habitList = habitList.map((h) =>
          h.id === habit.id ? { ...h, notifications: prevNotifications } : h,
        );
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function toggleEnabled(habit: Habit) {
    const prevEnabled = habit.enabled;
    habitList = habitList.map((h) => (h.id === habit.id ? { ...h, enabled: !h.enabled } : h));
    try {
      const updated = await habitsApi.update(habit.id, { enabled: !prevEnabled });
      habitList = habitList.map((h) => (h.id === habit.id ? updated : h));
    } catch (err) {
      if (!(err instanceof TypeError)) {
        habitList = habitList.map((h) => (h.id === habit.id ? { ...h, enabled: prevEnabled } : h));
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function deleteHabit(id: string) {
    try {
      await habitsApi.delete(id);
      habitList = habitList.filter((h) => h.id !== id);
      showSuccess('Habit deleted successfully.');
    } catch (err) {
      if (err instanceof TypeError) {
        habitList = habitList.filter((h) => h.id !== id);
        showSuccess('Habit deleted (offline).');
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
    confirmingDeleteId = null;
    menuOpenId = null;
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      habitList = await habitsApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        error = 'Unable to connect. Please check your network.';
      } else {
        error = err instanceof ApiError ? err.message : 'Failed to load data.';
      }
    } finally {
      loading = false;
    }
    loadStreaksAndCompletions();

    loadCalendars();

    const cachedSettings = getCachedSettings();
    if (cachedSettings) {
      userSettings = cachedSettings;
    } else {
      settingsApi
        .get()
        .then((s) => {
          userSettings = s;
          setCachedSettings(s);
        })
        .catch(() => {});
    }

    billingApi
      .status()
      .then((s) => {
        billingStatus = s;
      })
      .catch(() => {});

    templateState.load();

    // Deep-link: open edit panel from ?edit=<id> query param
    const editId = untrack(() => page.url.searchParams.get('edit'));
    if (editId) {
      const habit = habitList.find((h) => h.id === editId);
      if (habit) {
        await tick();
        openEditForm(habit);
      }
      const url = new URL(untrack(() => page.url));
      url.searchParams.delete('edit');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Habits')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="page-wrapper">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Habits</h1>
    <div class="header-actions">
      {#if showUsageCounter}
        <span class="usage-counter" class:usage-counter--warn={atLimit}>
          {habitList.length} of {habitLimit}
        </span>
      {/if}
      <button onclick={openAddForm} class="btn-accent-pill" aria-haspopup="dialog">
        <Plus size={16} strokeWidth={1.5} />
        Add Habit
      </button>
    </div>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}

  {#if loading}
    <div class="loading-container" role="status" aria-live="polite">
      <p class="loading-text">Loading...</p>
    </div>
  {:else if habitList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Repeat size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 class="empty-state-title">No habits yet</h2>
      <p class="empty-state-desc">Create your first habit to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-state-btn" aria-haspopup="dialog">
        <Plus size={16} strokeWidth={1.5} />
        Add Habit
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Habits list">
      <!-- Table Header -->
      <div role="rowgroup">
        <div class="table-header habits-grid" role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Streak</span>
          <span role="columnheader">Priority</span>
          <span role="columnheader" class="hide-mobile">Frequency</span>
          <span role="columnheader" class="hide-mobile">Duration</span>
          <span role="columnheader" class="hide-mobile">Window</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" aria-label="Actions"></span>
        </div>
      </div>

      <!-- Table Rows -->
      <div role="rowgroup">
        {#each habitList as habit (habit.id)}
          <div class="table-row habits-grid" class:frozen={!habit.enabled} role="row">
            <span role="cell" class="name-cell">
              <button
                class="name-btn"
                onclick={() => openEditForm(habit)}
                tabindex={!habit.enabled ? -1 : undefined}>{habit.name}</button
              >
              {#if !habit.enabled}
                <span class="frozen-badge" title="Upgrade to Pro to unfreeze">
                  <Lock size={12} strokeWidth={1.5} />
                  Frozen
                </span>
              {/if}
              {#if habit.forced}
                <Lock size={14} strokeWidth={1.5} class="icon-tertiary" />
              {/if}
              <button
                class="toggle-btn notification-toggle"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleNotifications(habit);
                }}
                aria-label={habit.notifications ? 'Disable notifications' : 'Enable notifications'}
                title={habit.notifications ? 'Notifications on' : 'Notifications off'}
                tabindex={!habit.enabled ? -1 : undefined}
              >
                {#if habit.notifications}
                  <Bell size={14} strokeWidth={1.5} class="icon-accent" />
                {:else}
                  <BellOff size={14} strokeWidth={1.5} class="icon-tertiary" />
                {/if}
              </button>
              {#if habit.dependsOn}
                <span class="dependency-badge" title="Depends on: {getParentName(habit.dependsOn)}">
                  <Link2 size={12} strokeWidth={1.5} />
                  {getParentName(habit.dependsOn)}
                </span>
              {/if}
            </span>
            <span role="cell">
              {#if (streaks[habit.id] || 0) > 0}
                <span class="streak-badge">
                  <Flame size={14} strokeWidth={1.5} />
                  {streaks[habit.id]}
                </span>
              {:else}
                <span class="icon-tertiary" style="font-size: 0.8125rem;">--</span>
              {/if}
            </span>
            <span role="cell">
              <span class="priority-badge priority-{habit.priority}"
                >{priorityLabels[habit.priority]}</span
              >
            </span>
            <span role="cell" class="hide-mobile freq-cell">{habit.frequency}</span>
            <span
              role="cell"
              class="font-mono hide-mobile"
              style="color: var(--color-text-secondary);"
              >{habit.durationMin}-{habit.durationMax}m</span
            >
            <span
              role="cell"
              class="font-mono hide-mobile"
              style="color: var(--color-text-secondary);"
              >{habit.windowStart}-{habit.windowEnd}</span
            >
            <span role="cell">
              <button
                class="toggle-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleEnabled(habit);
                }}
                role="switch"
                aria-checked={habit.enabled}
                aria-label={habit.enabled ? 'Disable habit' : 'Enable habit'}
                tabindex={!habit.enabled ? -1 : undefined}
              >
                {#if habit.enabled}
                  <ToggleRight size={20} strokeWidth={1.5} class="icon-accent" />
                {:else}
                  <ToggleLeft size={20} strokeWidth={1.5} class="icon-tertiary" />
                {/if}
              </button>
            </span>
            <span role="cell">
              <KebabMenu
                open={menuOpenId === habit.id}
                ontoggle={(open) => {
                  confirmingDeleteId = null;
                  menuOpenId = open ? habit.id : null;
                }}
                itemName={habit.name}
              >
                {#if confirmingDeleteId === habit.id}
                  <span class="confirm-text" role="none">Delete this habit?</span>
                  <button
                    class="kebab-menu-item kebab-menu-item--danger"
                    role="menuitem"
                    onclick={() => deleteHabit(habit.id)}
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
                      markComplete(habit.id);
                    }}
                  >
                    <CircleCheck size={15} strokeWidth={1.5} />
                    Mark complete
                  </button>
                  <button
                    class="kebab-menu-item"
                    role="menuitem"
                    onclick={() => {
                      menuOpenId = null;
                      openEditForm(habit);
                    }}
                  >
                    <Pencil size={15} strokeWidth={1.5} />
                    Edit
                  </button>
                  <button
                    class="kebab-menu-item kebab-menu-item--danger"
                    role="menuitem"
                    onclick={() => {
                      confirmingDeleteId = habit.id;
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
  title={editingHabit ? 'Edit Habit' : 'Add Habit'}
  onclose={closePanel}
>
  <HabitForm
    {editingHabit}
    calendars={calendarList.filter((c) => c.mode === CalendarMode.Writable && c.enabled)}
    templates={schedulingTemplates}
    {userSettings}
    {submitting}
    streak={editingHabit ? streaks[editingHabit.id] || 0 : 0}
    completions={editingHabit ? completions[editingHabit.id] || [] : []}
    onsubmit={handleFormSubmit}
    oncancel={closePanel}
    onmarkcomplete={markComplete}
  />
</SlideOverPanel>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .habits-grid {
    grid-template-columns: 1fr 60px 80px 100px 120px 140px 60px 40px;
  }

  @include mobile {
    .habits-grid {
      grid-template-columns: 1fr 60px 80px 60px 40px;
    }
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
  }

  .name-btn {
    @include text-truncate;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;

    &:hover {
      color: var(--color-accent);
    }
  }

  .freq-cell {
    color: var(--color-text-secondary);
    text-transform: capitalize;
  }

  .notification-toggle {
    padding: 0;
    flex-shrink: 0;
    line-height: 0;
  }

  .streak-badge {
    @include badge;
    gap: 3px;
    padding: 0 4px;
    font-size: 0.8125rem;
    color: var(--color-warning-amber);
  }

  .dependency-badge {
    @include badge;
    gap: 3px;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    white-space: nowrap;
  }
</style>
