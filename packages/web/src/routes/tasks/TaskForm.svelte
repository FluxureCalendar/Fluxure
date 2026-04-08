<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import type { Task } from '@fluxure/shared';
  import { SchedulingHours, Priority } from '@fluxure/shared';
  import { tasks } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';
  import DurationSlider from '$lib/components/DurationSlider.svelte';

  import X from 'lucide-svelte/icons/x';

  let {
    open,
    task,
    onclose,
    onsaved,
  }: {
    open: boolean;
    task: Task | null;
    onclose: () => void;
    onsaved?: () => void;
  } = $props();

  const isEdit = $derived(task !== null);

  let name = $state('');
  let totalDuration = $state(60);
  let dueDate = $state('');
  let chunkMin = $state(15);
  let chunkMax = $state(120);
  let schedulingHours = $state<SchedulingHours>(SchedulingHours.Working);
  let priority = $state<Priority>(Priority.Medium);
  let color = $state('#5B8DB8');
  let saving = $state(false);

  const tmpl = createSchedulingTemplateState();

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

  // Keep chunkMax >= chunkMin
  $effect(() => {
    if (chunkMax < chunkMin) chunkMax = chunkMin;
  });

  let validationError = $derived(
    !name.trim()
      ? 'Name is required'
      : totalDuration < 5
        ? 'Total duration must be at least 5 minutes'
        : chunkMax < chunkMin
          ? 'Max chunk must be >= min chunk'
          : '',
  );

  let isValid = $derived(!validationError);

  $effect(() => {
    if (open && task) {
      name = task.name;
      totalDuration = task.totalDuration;
      dueDate = task.dueDate ? task.dueDate.slice(0, 10) : '';
      chunkMin = task.chunkMin;
      chunkMax = task.chunkMax;
      schedulingHours = task.schedulingHours;
      priority = task.priority;
      color = task.color || '#5B8DB8';
    } else if (open && !task) {
      name = '';
      totalDuration = 60;
      dueDate = '';
      chunkMin = 15;
      chunkMax = 120;
      schedulingHours = SchedulingHours.Working;
      priority = Priority.Medium;
      color = '#5B8DB8';
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
        totalDuration,
        dueDate: dueDate || null,
        chunkMin,
        chunkMax,
        schedulingHours,
        priority,
        color,
      };

      if (isEdit && task) {
        await tasks.update(task.id, data);
        showToast('Task updated', 'success');
      } else {
        await tasks.create(data);
        showToast('Task created', 'success');
      }
      onsaved?.();
      onclose();
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to save task', 'error');
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
        <h2 class="modal-title">{isEdit ? 'Edit task' : 'New task'}</h2>
        <button class="modal-close" onclick={onclose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <form class="modal-body" onsubmit={handleSubmit}>
        <div class="form-field">
          <label class="form-label" for="task-name">Name</label>
          <input
            id="task-name"
            class="form-input"
            bind:value={name}
            required
            placeholder="e.g., Write proposal"
          />
        </div>

        <DurationSlider bind:value={totalDuration} label="Total duration" min={5} max={2400} />

        <div class="form-field">
          <label class="form-label" for="task-due">Due date</label>
          <input id="task-due" class="form-input" type="date" bind:value={dueDate} />
        </div>

        <DurationSlider bind:value={chunkMin} label="Min chunk" min={5} max={480} />
        <DurationSlider bind:value={chunkMax} label="Max chunk" min={5} max={480} />

        <div class="form-field">
          <label class="form-label" for="task-schedule">Schedule during</label>
          <select
            id="task-schedule"
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

        <div class="form-field">
          <label class="form-label" for="task-priority">Priority</label>
          <select id="task-priority" class="form-select" bind:value={priority}>
            <option value={Priority.Critical}>Critical</option>
            <option value={Priority.High}>High</option>
            <option value={Priority.Medium}>Medium</option>
            <option value={Priority.Low}>Low</option>
          </select>
        </div>

        <div class="form-field">
          <span class="form-label" id="task-color-label">Color</span>
          <div class="color-row" role="group" aria-labelledby="task-color-label">
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
