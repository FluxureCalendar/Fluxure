<script lang="ts">
  import { onMount } from 'svelte';
  import { schedulingTemplates, type SchedulingTemplate } from '$lib/api';
  import { getCachedTemplates, setCachedTemplates } from '$lib/cache.svelte';
  import { showToast } from '$lib/toast.svelte';

  import Trash2 from 'lucide-svelte/icons/trash-2';
  import TimeRangeSlider from '$lib/components/TimeRangeSlider.svelte';

  let templates = $state<SchedulingTemplate[]>([]);
  let loading = $state(true);

  let newName = $state('');
  let newStart = $state('09:00');
  let newEnd = $state('17:00');
  let adding = $state(false);

  async function loadTemplates() {
    try {
      const cached = getCachedTemplates();
      if (cached) {
        templates = cached;
      } else {
        const result = await schedulingTemplates.list();
        templates = result.templates;
        setCachedTemplates(result.templates);
      }
    } catch {
      // silent
    } finally {
      loading = false;
    }
  }

  async function addTemplate() {
    if (!newName.trim() || adding) return;
    adding = true;
    try {
      const result = await schedulingTemplates.create({
        name: newName.trim(),
        startTime: newStart,
        endTime: newEnd,
      });
      templates = [...templates, result.template];
      setCachedTemplates(templates);
      newName = '';
      newStart = '09:00';
      newEnd = '17:00';
      showToast('Template created', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to create template', 'error');
      }
    } finally {
      adding = false;
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await schedulingTemplates.delete(id);
      templates = templates.filter((t) => t.id !== id);
      setCachedTemplates(templates);
      showToast('Template deleted', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to delete template', 'error');
      }
    }
  }

  onMount(() => {
    loadTemplates();
  });
</script>

<section class="settings-section" data-setting-id="scheduling-templates">
  <h3>Scheduling templates <span class="count">({templates.length}/8)</span></h3>

  {#if loading}
    <p class="text-secondary">Loading...</p>
  {:else}
    {#if templates.length > 0}
      <div class="template-list">
        {#each templates as tmpl (tmpl.id)}
          <div class="template-row">
            <span class="template-name">{tmpl.name}</span>
            <span class="template-time">{tmpl.startTime} - {tmpl.endTime}</span>
            <button
              class="icon-action icon-danger"
              onclick={() => deleteTemplate(tmpl.id)}
              aria-label="Delete {tmpl.name}"
            >
              <Trash2 size={14} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if templates.length < 8}
      <div class="add-template">
        <div class="form-field">
          <label class="form-label" for="tmpl-name">Name</label>
          <input
            id="tmpl-name"
            class="form-input"
            bind:value={newName}
            placeholder="Evening routine"
          />
        </div>
        <TimeRangeSlider bind:start={newStart} bind:end={newEnd} />
        <button class="btn-secondary" onclick={addTemplate} disabled={adding || !newName.trim()}>
          {adding ? 'Adding...' : 'Add template'}
        </button>
      </div>
    {/if}
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-section {
    @include flex-col(var(--space-4));
  }

  .count {
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--color-text-tertiary);
    opacity: 0.6;
  }

  .text-secondary {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .template-list {
    @include flex-col;
  }

  .template-row {
    display: grid;
    grid-template-columns: 1fr 120px 28px;
    align-items: center;
    padding: var(--space-2) 0;
    font-size: 0.875rem;

    & + & {
      border-top: 1px solid var(--color-border);
    }
  }

  .template-name {
    color: var(--color-text);
  }

  .template-time {
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .icon-action {
    @include icon-btn(24px);
    opacity: 0.3;
    transition: opacity var(--transition-fast);
    &:hover {
      opacity: 1;
    }
  }

  .icon-danger {
    &:hover {
      color: var(--color-danger);
      background: var(--color-danger-muted);
    }
  }

  .add-template {
    @include flex-col(var(--space-3));
    padding-top: var(--space-3);
  }
</style>
