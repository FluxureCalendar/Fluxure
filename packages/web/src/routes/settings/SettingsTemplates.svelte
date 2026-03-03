<script lang="ts">
  import type { SchedulingTemplate } from '$lib/api';
  import Plus from 'lucide-svelte/icons/plus';
  import Clock from 'lucide-svelte/icons/clock';
  import Trash2 from 'lucide-svelte/icons/trash-2';

  interface Props {
    templates: SchedulingTemplate[];
    onaddtemplate: (name: string, startTime: string, endTime: string) => Promise<void>;
    ondeletetemplate: (id: string) => void;
  }

  let { templates, onaddtemplate, ondeletetemplate }: Props = $props();

  let newTemplateName = $state('');
  let newTemplateStart = $state('09:00');
  let newTemplateEnd = $state('17:00');
  let templateError = $state('');
  let addingTemplate = $state(false);

  async function addTemplate() {
    templateError = '';
    const name = newTemplateName.trim();
    if (!name) {
      templateError = 'Name is required.';
      return;
    }
    if (name.length > 50) {
      templateError = 'Name must be 50 characters or less.';
      return;
    }
    if (newTemplateStart >= newTemplateEnd) {
      templateError = 'Start time must be before end time.';
      return;
    }
    if (templates.length >= 8) {
      templateError = 'Maximum 8 templates allowed.';
      return;
    }
    addingTemplate = true;
    try {
      await onaddtemplate(name, newTemplateStart, newTemplateEnd);
      newTemplateName = '';
      newTemplateStart = '09:00';
      newTemplateEnd = '17:00';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add template.';
      templateError = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
    } finally {
      addingTemplate = false;
    }
  }
</script>

<section aria-labelledby="templates-heading" class="settings-section">
  <div class="section-header-row">
    <h2 id="templates-heading" class="section-heading">Scheduling Templates</h2>
    <span class="template-count">{templates.length} / 8</span>
  </div>
  <p class="section-description">Define reusable time windows for habits, tasks, and focus time.</p>

  {#if templates.length === 0}
    <p class="empty-message">No custom templates yet.</p>
  {:else}
    <div class="template-list">
      {#each templates as template (template.id)}
        <div class="template-item">
          <div class="template-info">
            <Clock size={14} />
            <span class="template-name">{template.name}</span>
            <span class="template-time font-mono">{template.startTime} – {template.endTime}</span>
          </div>
          <button
            class="btn-icon-danger"
            onclick={() => ondeletetemplate(template.id)}
            aria-label="Delete template {template.name}"
          >
            <Trash2 size={14} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if templates.length < 8}
    <div class="template-form">
      <div class="form-field">
        <input
          type="text"
          placeholder="Template name"
          bind:value={newTemplateName}
          maxlength={50}
        />
      </div>
      <div class="form-field">
        <input type="time" bind:value={newTemplateStart} class="font-mono" />
      </div>
      <div class="form-field">
        <input
          type="time"
          bind:value={newTemplateEnd}
          class="font-mono"
          aria-invalid={newTemplateStart >= newTemplateEnd ? true : undefined}
        />
      </div>
      <button class="btn-sm btn-primary" onclick={addTemplate} disabled={addingTemplate}>
        <Plus size={14} />
        Add
      </button>
    </div>
    {#if templateError}
      <p class="validation-error">{templateError}</p>
    {/if}
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .section-description {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-4) 0;
  }

  .template-count {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    font-weight: 500;
  }

  .empty-message {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin: 0;
  }

  .template-list {
    @include flex-col(var(--space-2));
    margin-bottom: var(--space-4);
  }

  .template-item {
    @include flex-between;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .template-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .template-name {
    color: var(--color-text);
    font-weight: 500;
  }

  .template-time {
    color: var(--color-text-tertiary);
    font-size: 0.75rem;
  }

  .template-form {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: var(--space-2);
    align-items: end;
  }

  .validation-error {
    font-size: 0.8125rem;
    color: var(--color-danger);
    margin: var(--space-2) 0 0 0;
  }
</style>
