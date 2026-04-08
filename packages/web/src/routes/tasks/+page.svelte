<script lang="ts">
  import { onMount } from 'svelte';
  import { pageTitle } from '$lib/brand';
  import { tasks } from '$lib/api';
  import type { Task } from '@fluxure/shared';
  import { Priority, TaskStatus } from '@fluxure/shared';
  import { showToast } from '$lib/toast.svelte';
  import { formatDuration } from '$lib/utils/format';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import EntityCard from '$lib/components/EntityCard.svelte';
  import TaskForm from './TaskForm.svelte';

  import Plus from 'lucide-svelte/icons/plus';
  import Check from 'lucide-svelte/icons/check';
  import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';
  import Clock from 'lucide-svelte/icons/clock';
  import CalendarDays from 'lucide-svelte/icons/calendar-days';
  import Flag from 'lucide-svelte/icons/flag';

  let taskList = $state<Task[]>([]);
  let loading = $state(true);
  let formOpen = $state(false);
  let editingTask = $state<Task | null>(null);
  let confirmDeleteId = $state<string | null>(null);
  let loadError = $state('');

  let activeTasks = $derived(taskList.filter((t) => t.status !== TaskStatus.Completed));
  let completedTasks = $derived(taskList.filter((t) => t.status === TaskStatus.Completed));
  let showCompleted = $state(false);

  async function loadTasks() {
    try {
      loadError = '';
      taskList = await tasks.list();
    } catch {
      loadError = 'Failed to load tasks. Please try again.';
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editingTask = null;
    formOpen = true;
  }
  function openEdit(t: Task) {
    editingTask = t;
    formOpen = true;
  }

  async function completeTask(t: Task) {
    taskList = taskList.map((x) => (x.id === t.id ? { ...x, status: TaskStatus.Completed } : x));
    tasks
      .complete(t.id)
      .then(() => showToast('Task completed', 'success'))
      .catch(() => {
        taskList = taskList.map((x) => (x.id === t.id ? { ...x, status: t.status } : x));
        showToast('Failed to complete task', 'error');
      });
  }

  async function deleteTask(t: Task) {
    confirmDeleteId = null;
    try {
      await tasks.delete(t.id);
      taskList = taskList.filter((x) => x.id !== t.id);
      showToast('Task deleted', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) showToast('Failed to delete task', 'error');
    }
  }

  function fmtDate(d: string | null): string {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function priorityLabel(p: Priority): string {
    switch (p) {
      case Priority.Critical:
        return 'Critical';
      case Priority.High:
        return 'High';
      case Priority.Medium:
        return 'Medium';
      case Priority.Low:
        return 'Low';
      default:
        return '';
    }
  }

  function priorityColor(p: Priority): string {
    switch (p) {
      case Priority.Critical:
        return 'var(--color-danger)';
      case Priority.High:
        return 'var(--color-warning)';
      case Priority.Medium:
        return 'var(--color-accent)';
      default:
        return 'var(--color-text-tertiary)';
    }
  }

  function isOverdue(t: Task): boolean {
    if (!t.dueDate || t.status === TaskStatus.Completed) return false;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return t.dueDate < todayStr;
  }

  onMount(async () => {
    await loadTasks();
    const editId = new URL(window.location.href).searchParams.get('edit');
    if (editId) {
      const task = taskList.find((t) => t.id === editId);
      if (task) openEdit(task);
      window.history.replaceState({}, '', '/tasks');
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Tasks')}</title>
</svelte:head>

<PageHeader title="Tasks" subtitle="Track work items and let Fluxure schedule them for you">
  {#if !loading && taskList.length > 0}
    <button class="btn-primary" onclick={openCreate}>
      <Plus size={16} /> Add task
    </button>
  {/if}
</PageHeader>

{#if !loading}
  {#if loadError}
    <div class="load-error">
      <p>{loadError}</p>
      <button onclick={loadTasks}>Retry</button>
    </div>
  {:else if taskList.length === 0}
    <EmptyState
      icon={CircleCheckBig}
      title="No tasks yet"
      message="Add a task to get started with intelligent scheduling."
      actionLabel="Create task"
      onaction={openCreate}
    />
  {:else}
    <div class="tasks-grid">
      {#each activeTasks as t, i (t.id)}
        <EntityCard
          name={t.name}
          color={t.color || 'var(--color-accent)'}
          index={i}
          confirmingDelete={confirmDeleteId === t.id}
          onclick={() => openEdit(t)}
          ondelete={() => (confirmDeleteId = t.id)}
          onconfirmdelete={() => deleteTask(t)}
          oncanceldelete={() => (confirmDeleteId = null)}
        >
          {#snippet chips()}
            <span class="entity-chip">
              <Clock size={11} />
              {formatDuration(t.remainingDuration)} left
            </span>
            <span class="entity-chip" style="color: {priorityColor(t.priority)}">
              <Flag size={11} />
              {priorityLabel(t.priority)}
            </span>
            {#if t.dueDate}
              <span class="entity-chip" class:entity-chip-overdue={isOverdue(t)}>
                <CalendarDays size={11} />
                {fmtDate(t.dueDate)}
              </span>
            {/if}
          {/snippet}

          {#snippet detail()}
            {#if t.totalDuration > 0}
              <div class="task-progress">
                <div class="task-progress-bar">
                  <div
                    class="task-progress-fill"
                    style="width: {Math.max(
                      2,
                      Math.round(((t.totalDuration - t.remainingDuration) / t.totalDuration) * 100),
                    )}%; background: {t.color || 'var(--color-accent)'}"
                  ></div>
                </div>
                <span class="task-progress-label"
                  >{Math.round(
                    ((t.totalDuration - t.remainingDuration) / t.totalDuration) * 100,
                  )}%</span
                >
              </div>
            {/if}
          {/snippet}

          {#snippet footer()}
            <button
              class="task-complete-btn"
              onclick={() => completeTask(t)}
              aria-label="Complete {t.name}"
            >
              <Check size={13} />
            </button>
          {/snippet}
        </EntityCard>
      {/each}
    </div>

    {#if completedTasks.length > 0}
      <button class="completed-toggle" onclick={() => (showCompleted = !showCompleted)}>
        {showCompleted ? 'Hide' : 'Show'}
        {completedTasks.length} completed
      </button>

      {#if showCompleted}
        <div class="tasks-grid tasks-completed">
          {#each completedTasks as t (t.id)}
            <EntityCard
              name={t.name}
              color={t.color || 'var(--color-accent)'}
              paused={true}
              confirmingDelete={confirmDeleteId === t.id}
              onclick={() => openEdit(t)}
              ondelete={() => (confirmDeleteId = t.id)}
              onconfirmdelete={() => deleteTask(t)}
              oncanceldelete={() => (confirmDeleteId = null)}
            >
              {#snippet chips()}
                <span class="entity-chip entity-chip-done"><Check size={11} /> Done</span>
              {/snippet}
            </EntityCard>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
{/if}

<TaskForm
  open={formOpen}
  task={editingTask}
  onclose={() => {
    formOpen = false;
  }}
  onsaved={loadTasks}
/>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .tasks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-3);
    @include mobile {
      grid-template-columns: 1fr;
    }
  }

  .task-progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }

  .task-progress-bar {
    flex: 1;
    height: 3px;
    background: var(--color-surface-hover);
    border-radius: 2px;
    overflow: hidden;
  }

  .task-progress-fill {
    height: 100%;
    border-radius: 2px;
    transition: width var(--transition-base);
  }

  .task-progress-label {
    font-size: 0.5625rem;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 28px;
    text-align: right;
  }

  .task-complete-btn {
    @include flex-center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--color-success);
    border-radius: 50%;
    background: transparent;
    color: var(--color-success);
    cursor: pointer;
    transition: all var(--transition-fast);
    &:hover {
      background: var(--color-success);
      color: white;
    }
  }

  .completed-toggle {
    display: block;
    margin: var(--space-4) 0 var(--space-2);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    font-family: $font-body;
    font-size: 0.75rem;
    cursor: pointer;
    transition: color var(--transition-fast);
    &:hover {
      color: var(--color-text-secondary);
    }
  }

  .tasks-completed {
    opacity: 0.7;
  }
</style>
