<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { page } from '$app/state';
  import { showSuccess } from '$lib/notifications.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { tasks as tasksApi, billing as billingApi, ApiError } from '$lib/api';
  import type { BillingStatus } from '$lib/api';
  import { isUnlimited, TaskStatus, SchedulingHours } from '@fluxure/shared';
  import { loadCalendars, getCalendars } from '$lib/calendars.svelte';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';
  import type { Task, Subtask, CreateTaskRequest } from '@fluxure/shared';
  import { formatDuration, formatDateShort } from '$lib/utils/format';
  import SlideOverPanel from '$lib/components/SlideOverPanel.svelte';
  import KebabMenu from '$lib/components/KebabMenu.svelte';
  import TaskForm from './TaskForm.svelte';
  import type { TaskFormData } from './TaskForm.svelte';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Zap from 'lucide-svelte/icons/zap';
  import Lock from 'lucide-svelte/icons/lock';
  import ListChecks from 'lucide-svelte/icons/list-checks';

  let taskList = $state<Task[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  const templateState = createSchedulingTemplateState();
  let schedulingTemplates = $derived(templateState.state.templates);
  let billingStatus = $state<BillingStatus | null>(null);

  let taskLimit = $derived(billingStatus?.limits.maxTasks ?? null);
  let showUsageCounter = $derived(taskLimit !== null && !isUnlimited(taskLimit));
  let atLimit = $derived(showUsageCounter && taskList.length >= (taskLimit ?? 0));

  let calendarList = $derived(getCalendars());

  let subtasks = $state<Subtask[]>([]);
  let newSubtaskName = $state('');
  let subtasksLoading = $state(false);
  let subtaskCounts = $state<Record<string, { done: number; total: number }>>({});

  const priorityLabels: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
  const statusLabels: Record<string, string> = {
    open: 'Open',
    done_scheduling: 'Done Scheduling',
    completed: 'Completed',
  };

  function progress(task: Task): number {
    return task.totalDuration > 0
      ? Math.round(((task.totalDuration - task.remainingDuration) / task.totalDuration) * 100)
      : 0;
  }

  function resetForm() {
    editingId = null;
  }

  async function loadAllSubtaskCounts() {
    try {
      subtaskCounts = await tasksApi.getSubtaskCounts();
    } catch {
      // Fallback: batch endpoint not available, try per-task
      const results = await Promise.all(
        taskList.map(async (task) => {
          try {
            const subs = await tasksApi.getSubtasks(task.id);
            const done = subs.filter((s) => s.completed).length;
            return { id: task.id, done, total: subs.length };
          } catch {
            return null;
          }
        }),
      );
      let newCounts = { ...subtaskCounts };
      for (const result of results) {
        if (result) {
          newCounts = { ...newCounts, [result.id]: { done: result.done, total: result.total } };
        }
      }
      subtaskCounts = newCounts;
    }
  }

  async function loadSubtasks(taskId: string) {
    subtasksLoading = true;
    subtasks = [];
    try {
      subtasks = await tasksApi.getSubtasks(taskId);
    } catch {
      // API not available, keep empty
    } finally {
      subtasksLoading = false;
    }
  }

  async function addSubtask() {
    if (!editingId || !newSubtaskName.trim()) return;
    try {
      const created = await tasksApi.createSubtask(editingId, newSubtaskName.trim());
      subtasks = [...subtasks, created];
    } catch {
      // Optimistic offline
      subtasks = [
        ...subtasks,
        {
          id: crypto.randomUUID(),
          taskId: editingId,
          name: newSubtaskName.trim(),
          completed: false,
          sortOrder: subtasks.length,
          createdAt: new Date().toISOString(),
        },
      ];
    }
    newSubtaskName = '';
    syncSubtaskCounts();
  }

  async function toggleSubtask(subtask: Subtask) {
    if (!editingId) return;
    const updated = { ...subtask, completed: !subtask.completed };
    subtasks = subtasks.map((s) => (s.id === subtask.id ? updated : s));
    syncSubtaskCounts();
    try {
      await tasksApi.updateSubtask(editingId, subtask.id, { completed: updated.completed });
    } catch {
      // Already optimistically updated
    }
  }

  async function removeSubtask(subtask: Subtask) {
    if (!editingId) return;
    subtasks = subtasks.filter((s) => s.id !== subtask.id);
    syncSubtaskCounts();
    try {
      await tasksApi.deleteSubtask(editingId, subtask.id);
    } catch {
      // Already optimistically removed
    }
  }

  function syncSubtaskCounts() {
    if (!editingId) return;
    const done = subtasks.filter((s) => s.completed).length;
    subtaskCounts = { ...subtaskCounts, [editingId]: { done, total: subtasks.length } };
  }

  function openAddForm() {
    resetForm();
    subtasks = [];
    newSubtaskName = '';
    showPanel = true;
  }

  function openEditForm(task: Task) {
    editingId = task.id;
    newSubtaskName = '';
    showPanel = true;
    loadSubtasks(task.id);
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

  async function handleSubmit(formData: TaskFormData) {
    submitting = true;
    error = '';
    const dueDate = formData.dueDate
      ? new Date(formData.dueDate + 'T23:59:59').toISOString()
      : undefined;
    const taskData = {
      name: formData.name.trim(),
      priority: formData.priority,
      totalDuration: formData.totalDuration,
      dueDate,
      earliestStart: formData.earliestStart
        ? new Date(formData.earliestStart + 'T00:00:00').toISOString()
        : undefined,
      chunkMin: formData.chunkMin,
      chunkMax: formData.chunkMax,
      schedulingHours: formData.schedulingHours,
      calendarId: formData.calendarId || undefined,
      color: formData.color || undefined,
      skipBuffer: formData.skipBuffer,
    };

    try {
      if (editingId) {
        const updated = await tasksApi.update(editingId, taskData);
        taskList = taskList.map((t) => (t.id === editingId ? updated : t));
      } else {
        const created = await tasksApi.create({
          ...taskData,
          dueDate: dueDate ?? '',
        } as CreateTaskRequest);
        taskList = [...taskList, created];
      }
      showSuccess(editingId ? 'Task updated successfully.' : 'Task created successfully.');
      closePanel();
    } catch (err) {
      if (err instanceof TypeError) {
        // Optimistic offline update
        if (editingId) {
          taskList = taskList.map((t) =>
            t.id === editingId ? { ...t, ...taskData } : t,
          ) as Task[];
          showSuccess('Task updated (offline).');
        } else {
          const now = new Date().toISOString();
          taskList = [
            ...taskList,
            {
              id: crypto.randomUUID(),
              ...taskData,
              priority: taskData.priority ?? 3,
              dueDate: taskData.dueDate ?? null,
              earliestStart: taskData.earliestStart ?? now,
              chunkMin: taskData.chunkMin ?? 30,
              chunkMax: taskData.chunkMax ?? 120,
              schedulingHours: taskData.schedulingHours ?? SchedulingHours.Working,
              skipBuffer: taskData.skipBuffer ?? false,
              enabled: true,
              remainingDuration: taskData.totalDuration,
              status: TaskStatus.Open,
              isUpNext: false,
              createdAt: now,
              updatedAt: now,
            } satisfies Task,
          ];
          showSuccess('Task created (offline).');
        }
        closePanel();
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    } finally {
      submitting = false;
    }
  }

  async function toggleComplete(task: Task) {
    try {
      const updated = await tasksApi.complete(task.id);
      taskList = taskList.map((t) => (t.id === task.id ? updated : t));
    } catch (err) {
      if (err instanceof TypeError) {
        taskList = taskList.map((t) =>
          t.id === task.id
            ? ({
                ...t,
                status: t.status === 'completed' ? 'open' : 'completed',
                remainingDuration: t.status === 'completed' ? t.totalDuration : 0,
              } as unknown as Task)
            : t,
        );
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function toggleUpNext(task: Task) {
    try {
      const updated = await tasksApi.setUpNext(task.id, !task.isUpNext);
      taskList = taskList.map((t) => (t.id === task.id ? updated : t));
    } catch (err) {
      if (err instanceof TypeError) {
        taskList = taskList.map((t) => (t.id === task.id ? { ...t, isUpNext: !t.isUpNext } : t));
      } else {
        error = err instanceof ApiError ? err.message : 'Operation failed';
      }
    }
  }

  async function deleteTask(id: string) {
    try {
      await tasksApi.delete(id);
      taskList = taskList.filter((t) => t.id !== id);
      showSuccess('Task deleted successfully.');
    } catch (err) {
      if (err instanceof TypeError) {
        taskList = taskList.filter((t) => t.id !== id);
        showSuccess('Task deleted (offline).');
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
      taskList = await tasksApi.list();
    } catch (err) {
      if (err instanceof TypeError) {
        error = 'Unable to connect. Please check your network.';
      } else {
        error = err instanceof ApiError ? err.message : 'Failed to load data.';
      }
    } finally {
      loading = false;
    }
    loadAllSubtaskCounts();

    billingApi
      .status()
      .then((s) => {
        billingStatus = s;
      })
      .catch(() => {});

    loadCalendars();
    templateState.load();

    // Deep-link: open edit panel from ?edit=<id> query param
    const editId = untrack(() => page.url.searchParams.get('edit'));
    if (editId) {
      const task = taskList.find((t) => t.id === editId);
      if (task) {
        await tick();
        openEditForm(task);
      }
      const url = new URL(untrack(() => page.url));
      url.searchParams.delete('edit');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Tasks')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="page-wrapper">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Tasks</h1>
    <div class="header-actions">
      {#if showUsageCounter}
        <span class="usage-counter" class:usage-counter--warn={atLimit}>
          {taskList.length} of {taskLimit}
        </span>
      {/if}
      <button onclick={openAddForm} class="btn-accent-pill" aria-haspopup="dialog">
        <Plus size={16} strokeWidth={1.5} />
        Add Task
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
  {:else if taskList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <CheckSquare size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 class="empty-state-title">No tasks yet</h2>
      <p class="empty-state-desc">Create your first task to start scheduling</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-state-btn" aria-haspopup="dialog">
        <Plus size={16} strokeWidth={1.5} />
        Add Task
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Tasks list">
      <!-- Table Header -->
      <div role="rowgroup">
        <div class="table-header tasks-grid" role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Priority</span>
          <span role="columnheader" class="hide-mobile">Duration</span>
          <span role="columnheader" class="hide-mobile">Due Date</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Progress</span>
          <span role="columnheader" aria-label="Actions"></span>
        </div>
      </div>

      <!-- Table Rows -->
      <div role="rowgroup">
        {#each taskList as task (task.id)}
          <div class="table-row tasks-grid" class:frozen={!task.enabled} role="row">
            <span role="cell" class="name-cell">
              {#if task.status === 'completed'}
                <button
                  class="name-btn name-btn--completed"
                  onclick={() => openEditForm(task)}
                  tabindex={!task.enabled ? -1 : undefined}>{task.name}</button
                >
              {:else}
                <button
                  class="name-btn"
                  onclick={() => openEditForm(task)}
                  tabindex={!task.enabled ? -1 : undefined}>{task.name}</button
                >
              {/if}
              {#if !task.enabled}
                <span class="frozen-badge" title="Upgrade to Pro to unfreeze">
                  <Lock size={12} strokeWidth={1.5} />
                  Frozen
                </span>
              {/if}
              {#if task.isUpNext}
                <span class="upnext-badge">
                  <Zap size={12} strokeWidth={1.5} />
                  Up Next
                </span>
              {/if}
              {#if subtaskCounts[task.id]?.total}
                <span class="subtask-count-badge">
                  <ListChecks size={12} strokeWidth={1.5} />
                  {subtaskCounts[task.id].done}/{subtaskCounts[task.id].total}
                </span>
              {/if}
            </span>
            <span role="cell">
              <span class="priority-badge priority-{task.priority}"
                >{priorityLabels[task.priority]}</span
              >
            </span>
            <span
              role="cell"
              class="font-mono hide-mobile"
              style="color: var(--color-text-secondary); font-size: 0.8125rem;"
            >
              {formatDuration(task.remainingDuration)}/{formatDuration(task.totalDuration)}
            </span>
            <span
              role="cell"
              class="hide-mobile"
              style="color: var(--color-text-secondary); font-size: 0.8125rem;"
              >{formatDateShort(task.dueDate)}</span
            >
            <span role="cell">
              <span class="status-badge status-{task.status}">{statusLabels[task.status]}</span>
            </span>
            <span role="cell" style="display: flex; align-items: center; gap: var(--space-2);">
              <div class="progress-track">
                <div class="progress-fill" style="width: {progress(task)}%;"></div>
              </div>
              <span
                class="font-mono"
                style="font-size: 0.75rem; color: var(--color-text-secondary);"
                >{progress(task)}%</span
              >
            </span>
            <span role="cell">
              <KebabMenu
                open={menuOpenId === task.id}
                itemName={task.name}
                ontoggle={(open) => {
                  confirmingDeleteId = null;
                  menuOpenId = open ? task.id : null;
                }}
              >
                {#if confirmingDeleteId === task.id}
                  <span class="confirm-text" role="none">Delete this task?</span>
                  <button
                    class="kebab-menu-item kebab-menu-item--danger"
                    role="menuitem"
                    onclick={() => deleteTask(task.id)}
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
                      openEditForm(task);
                    }}
                  >
                    <Pencil size={15} strokeWidth={1.5} />
                    Edit
                  </button>
                  <button
                    class="kebab-menu-item kebab-menu-item--danger"
                    role="menuitem"
                    onclick={() => {
                      confirmingDeleteId = task.id;
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
<SlideOverPanel open={showPanel} title={editingId ? 'Edit Task' : 'Add Task'} onclose={closePanel}>
  <TaskForm
    editingTask={editingId ? (taskList.find((t) => t.id === editingId) ?? null) : null}
    calendars={calendarList}
    templates={schedulingTemplates}
    {subtasks}
    {subtasksLoading}
    bind:newSubtaskName
    {submitting}
    onsubmit={handleSubmit}
    oncancel={closePanel}
    ontogglecomplete={(task) => {
      toggleComplete(task);
      closePanel();
    }}
    ontoggleupnext={(task) => {
      toggleUpNext(task);
      closePanel();
    }}
    onaddsubtask={addSubtask}
    ontogglesubtask={toggleSubtask}
    onremovesubtask={removeSubtask}
  />
</SlideOverPanel>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .tasks-grid {
    grid-template-columns: 1fr 70px 90px 90px 80px 120px 40px;
  }

  @include mobile {
    .tasks-grid {
      grid-template-columns: 1fr 70px 80px 120px 40px;
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

    &--completed {
      text-decoration: line-through;
      color: var(--color-text-tertiary);
    }
  }

  /* Status badges */
  .status-badge {
    @include badge;
  }

  .status-open {
    background: var(--color-accent-muted);
    color: var(--color-accent);
  }

  .status-done_scheduling {
    background: var(--color-warning-amber-bg);
    color: var(--color-warning-amber);
  }

  .status-completed {
    background: var(--color-success-muted);
    color: var(--color-success);
  }

  /* Up Next badge */
  .upnext-badge {
    @include badge(var(--color-accent-muted), var(--color-accent));
    gap: 4px;
    font-size: 0.6875rem;
  }

  /* Progress bar */
  .progress-track {
    flex: 1;
    height: 4px;
    background: var(--color-border);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: var(--radius-full);
    transition: width var(--transition-base);
  }

  /* Subtask count badge on rows */
  .subtask-count-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    white-space: nowrap;
  }
</style>
