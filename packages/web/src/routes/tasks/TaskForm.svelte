<script lang="ts">
  import type { SchedulingTemplate } from '$lib/api';
  import {
    SchedulingHours,
    CalendarMode,
    COLOR_PALETTE,
    COLOR_NAMES,
    DEFAULT_TASK_DURATION,
    DEFAULT_CHUNK_MIN,
    DEFAULT_CHUNK_MAX,
  } from '@fluxure/shared';
  import type { Task, Subtask, Calendar } from '@fluxure/shared';
  import {
    handleScheduleDropdownChange as handleDropdown,
    getScheduleDropdownValue,
  } from '$lib/utils/scheduling-dropdown';
  import Plus from 'lucide-svelte/icons/plus';
  import X from 'lucide-svelte/icons/x';
  import ListChecks from 'lucide-svelte/icons/list-checks';

  const colorNames = COLOR_NAMES;

  interface Props {
    editingTask: Task | null;
    calendars: Calendar[];
    templates: SchedulingTemplate[];
    subtasks: Subtask[];
    subtasksLoading: boolean;
    newSubtaskName: string;
    submitting: boolean;
    onsubmit: (data: TaskFormData) => void;
    oncancel: () => void;
    ontogglecomplete: (task: Task) => void;
    ontoggleupnext: (task: Task) => void;
    onaddsubtask: () => void;
    ontogglesubtask: (subtask: Subtask) => void;
    onremovesubtask: (subtask: Subtask) => void;
  }

  export interface TaskFormData {
    name: string;
    priority: number;
    totalDuration: number;
    dueDate: string;
    earliestStart: string;
    chunkMin: number;
    chunkMax: number;
    schedulingHours: SchedulingHours;
    calendarId: string;
    color: string;
    skipBuffer: boolean;
  }

  let {
    editingTask,
    calendars,
    templates,
    subtasks,
    subtasksLoading,
    newSubtaskName = $bindable(),
    submitting,
    onsubmit,
    oncancel,
    ontogglecomplete,
    ontoggleupnext,
    onaddsubtask,
    ontogglesubtask,
    onremovesubtask,
  }: Props = $props();

  let formName = $state('');
  let formPriority = $state(3);
  let formTotalDuration = $state(DEFAULT_TASK_DURATION);
  let formDueDate = $state('');
  let formEarliestStart = $state('');
  let formChunkMin = $state(DEFAULT_CHUNK_MIN);
  let formChunkMax = $state(DEFAULT_CHUNK_MAX);
  let formSchedulingHours: SchedulingHours = $state(SchedulingHours.Working);
  let selectedTemplateId = $state<string | null>(null);
  let formCalendarId = $state('');
  let formColor = $state('');
  let formSkipBuffer = $state(false);
  let formError = $state('');

  function toDateInputValue(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().split('T')[0];
  }

  // Populate form fields when editingTask changes
  $effect(() => {
    if (editingTask) {
      formName = editingTask.name;
      formPriority = editingTask.priority;
      formTotalDuration = editingTask.totalDuration;
      formDueDate = toDateInputValue(editingTask.dueDate);
      formEarliestStart = toDateInputValue(editingTask.earliestStart);
      formChunkMin = editingTask.chunkMin;
      formChunkMax = editingTask.chunkMax;
      formSchedulingHours = editingTask.schedulingHours ?? 'working';
      formCalendarId = editingTask.calendarId ?? '';
      formColor = editingTask.color ?? '';
      formSkipBuffer = editingTask.skipBuffer ?? false;
    } else {
      formName = '';
      formPriority = 3;
      formTotalDuration = DEFAULT_TASK_DURATION;
      formDueDate = '';
      formEarliestStart = '';
      formChunkMin = DEFAULT_CHUNK_MIN;
      formChunkMax = DEFAULT_CHUNK_MAX;
      formSchedulingHours = SchedulingHours.Working;
      selectedTemplateId = null;
      formCalendarId = calendars.find((c) => c.isPrimary)?.id ?? calendars[0]?.id ?? '';
      formColor = '';
      formSkipBuffer = false;
    }
  });

  function handleScheduleDropdownChange(value: string) {
    handleDropdown(value, templates, (hours, tmplId) => {
      formSchedulingHours = hours;
      selectedTemplateId = tmplId;
    });
  }

  function subtaskCompletionText(): string {
    if (subtasks.length === 0) return '';
    const done = subtasks.filter((s) => s.completed).length;
    return `${done}/${subtasks.length} subtasks`;
  }

  function handleFormSubmit() {
    formError = '';
    if (formEarliestStart && formDueDate && formEarliestStart >= formDueDate) {
      formError = 'Earliest start must be before due date';
      return;
    }
    if (formChunkMin > formChunkMax) {
      formError = 'Chunk minimum cannot exceed chunk maximum';
      return;
    }
    onsubmit({
      name: formName,
      priority: formPriority,
      totalDuration: formTotalDuration,
      dueDate: formDueDate,
      earliestStart: formEarliestStart,
      chunkMin: formChunkMin,
      chunkMax: formChunkMax,
      schedulingHours: formSchedulingHours,
      calendarId: formCalendarId,
      color: formColor,
      skipBuffer: formSkipBuffer,
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
    <div class="alert-error" id="task-form-error" role="alert">{formError}</div>
  {/if}

  <div class="form-field">
    <label for="task-name">Name</label>
    <input
      id="task-name"
      type="text"
      bind:value={formName}
      required
      placeholder="e.g., Write documentation"
      aria-describedby={formError ? 'task-form-error' : undefined}
    />
  </div>

  <div class="form-field">
    <label for="task-priority">Priority</label>
    <select id="task-priority" bind:value={formPriority}>
      <option value={1}>P1 - Critical</option>
      <option value={2}>P2 - High</option>
      <option value={3}>P3 - Medium</option>
      <option value={4}>P4 - Low</option>
    </select>
  </div>

  <div class="form-field">
    <label for="task-dur">Total Duration (minutes)</label>
    <input id="task-dur" type="number" bind:value={formTotalDuration} min="5" />
  </div>

  <div class="form-row">
    <div class="form-field">
      <label for="task-due">Due Date</label>
      <input id="task-due" type="date" bind:value={formDueDate} required />
    </div>
    <div class="form-field">
      <label for="task-start">Earliest Start</label>
      <input
        id="task-start"
        type="date"
        bind:value={formEarliestStart}
        aria-invalid={formError.includes('Earliest start') ? true : undefined}
      />
    </div>
  </div>

  <div class="form-row">
    <div class="form-field">
      <label for="task-chunk-min">Chunk Min (min)</label>
      <input
        id="task-chunk-min"
        type="number"
        bind:value={formChunkMin}
        min="5"
        aria-invalid={formError.includes('Chunk') ? true : undefined}
        aria-describedby={formError.includes('Chunk') ? 'task-form-error' : undefined}
      />
    </div>
    <div class="form-field">
      <label for="task-chunk-max">Chunk Max (min)</label>
      <input
        id="task-chunk-max"
        type="number"
        bind:value={formChunkMax}
        min="5"
        aria-invalid={formError.includes('Chunk') ? true : undefined}
        aria-describedby={formError.includes('Chunk') ? 'task-form-error' : undefined}
      />
    </div>
  </div>

  <div class="form-field">
    <label for="task-sched">Schedule during</label>
    <select
      id="task-sched"
      value={getScheduleDropdownValue(formSchedulingHours, selectedTemplateId)}
      onchange={(e) => handleScheduleDropdownChange(e.currentTarget.value)}
    >
      <option value="working">Work hours</option>
      <option value="personal">Personal hours</option>
      <option value="custom">Anytime (custom)</option>
      {#if templates.length > 0}
        <optgroup label="Templates">
          {#each templates as tmpl (tmpl.id)}
            <option value="template:{tmpl.id}">{tmpl.name} ({tmpl.startTime}–{tmpl.endTime})</option
            >
          {/each}
        </optgroup>
      {/if}
    </select>
  </div>

  {#if calendars.some((c) => c.mode === CalendarMode.Writable && c.enabled)}
    <div class="form-field">
      <label for="task-calendar">Calendar</label>
      <select id="task-calendar" bind:value={formCalendarId}>
        {#each calendars.filter((c) => c.mode === CalendarMode.Writable && c.enabled) as cal (cal.id)}
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
      <input type="checkbox" bind:checked={formSkipBuffer} />
      <span>No buffer time</span>
    </label>
  </div>

  {#if editingTask}
    <div class="task-actions">
      <button
        type="button"
        class="btn-action"
        onclick={(e) => {
          e.preventDefault();
          ontogglecomplete(editingTask!);
        }}
      >
        {editingTask.status === 'completed' ? 'Reopen' : 'Complete'}
      </button>
      <button
        type="button"
        class="btn-action"
        onclick={(e) => {
          e.preventDefault();
          ontoggleupnext(editingTask!);
        }}
      >
        {editingTask.isUpNext ? 'Remove Up Next' : 'Set Up Next'}
      </button>
    </div>

    <!-- Subtasks Section -->
    <div class="subtasks-section">
      <div class="subtasks-header">
        <span class="subtasks-title">
          <ListChecks size={16} strokeWidth={1.5} />
          Subtasks
        </span>
        {#if subtasks.length > 0}
          <span class="subtasks-count">{subtaskCompletionText()}</span>
        {/if}
      </div>

      {#if subtasksLoading}
        <p style="font-size: 0.8125rem; color: var(--color-text-tertiary);">Loading subtasks...</p>
      {:else}
        <div class="subtasks-list">
          {#each subtasks as subtask (subtask.id)}
            <div class="subtask-item">
              <label class="subtask-check">
                <input
                  type="checkbox"
                  checked={subtask.completed}
                  onchange={() => ontogglesubtask(subtask)}
                />
                <span class:subtask-done={subtask.completed}>{subtask.name}</span>
              </label>
              <button
                type="button"
                class="subtask-delete"
                onclick={() => onremovesubtask(subtask)}
                aria-label="Delete subtask"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          {/each}
        </div>

        <div class="subtask-add">
          <input
            type="text"
            placeholder="Add subtask..."
            aria-label="Add subtask"
            bind:value={newSubtaskName}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onaddsubtask();
              }
            }}
          />
          <button
            type="button"
            class="subtask-add-btn"
            onclick={onaddsubtask}
            disabled={!newSubtaskName.trim()}
            aria-label="Add subtask"
          >
            <Plus size={16} strokeWidth={1.5} />
          </button>
        </div>
      {/if}
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

  .task-actions {
    display: flex;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
  }

  .form-toggles {
    display: flex;
    gap: var(--space-6);
    padding: var(--space-2) 0;
    flex-wrap: wrap;
  }

  /* Subtasks Section */
  .subtasks-section {
    @include flex-col(var(--space-3));
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }

  .subtasks-header {
    @include flex-between;
  }

  .subtasks-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }

  .subtasks-count {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
  }

  .subtasks-list {
    @include flex-col(2px);
  }

  .subtask-item {
    @include flex-between;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  .subtask-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);
    cursor: pointer;
  }

  .subtask-done {
    text-decoration: line-through;
    color: var(--color-text-tertiary);
  }

  .subtask-delete {
    @include flex-center;
    padding: 2px;
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    opacity: 0;
    transition:
      opacity var(--transition-fast),
      color var(--transition-fast);

    &:hover {
      color: var(--color-danger);
    }
  }

  .subtask-item:hover .subtask-delete {
    opacity: 1;
  }

  .subtask-add {
    display: flex;
    gap: var(--space-2);
    align-items: center;

    input {
      flex: 1;
      font-size: 0.8125rem;
    }
  }

  .subtask-add-btn {
    @include flex-center;
    padding: var(--space-1);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--color-surface-hover);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
</style>
