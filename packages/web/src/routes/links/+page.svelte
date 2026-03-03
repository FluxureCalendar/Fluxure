<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { showSuccess } from '$lib/notifications.svelte';
  import { onMount, tick } from 'svelte';
  import { links as linksApi } from '$lib/api';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';
  import type { SchedulingLink } from '@fluxure/shared';
  import { SchedulingHours, COPY_FEEDBACK_DURATION_MS, SLUG_PATTERN } from '@fluxure/shared';
  import SlideOverPanel from '$lib/components/SlideOverPanel.svelte';
  import KebabMenu from '$lib/components/KebabMenu.svelte';
  import Plus from 'lucide-svelte/icons/plus';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Link from 'lucide-svelte/icons/link';
  import Copy from 'lucide-svelte/icons/copy';
  import Check from 'lucide-svelte/icons/check';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import ToggleLeft from 'lucide-svelte/icons/toggle-left';
  import ToggleRight from 'lucide-svelte/icons/toggle-right';

  let linkList = $state<SchedulingLink[]>([]);
  let showPanel = $state(false);
  let editingId = $state<string | null>(null);
  let copyFeedback = $state<string | null>(null);
  let copyError = $state<string | null>(null);
  let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let copyErrorTimer: ReturnType<typeof setTimeout> | undefined;
  let loading = $state(true);
  let error = $state('');
  let submitting = $state(false);
  let menuOpenId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let menuFocusIndex = $state(-1);
  let slugError = $state('');
  let menuItemEls = $state<(HTMLButtonElement | null)[]>([null, null]);

  let formName = $state('');
  let formSlug = $state('');
  let formPriority = $state(3);
  let formDuration15 = $state(false);
  let formDuration30 = $state(true);
  let formDuration60 = $state(false);
  let formSchedulingHours: SchedulingHours = $state(SchedulingHours.Working);
  let manualSlugEdit = $state(false);

  const templateState = createSchedulingTemplateState();
  let schedulingTemplates = $derived(templateState.state.templates);

  function handleScheduleDropdownChange(value: string) {
    templateState.handleDropdownChange(value, (hours) => {
      formSchedulingHours = hours;
    });
  }

  function resetForm() {
    formName = '';
    formSlug = '';
    formPriority = 3;
    formDuration15 = false;
    formDuration30 = true;
    formDuration60 = false;
    formSchedulingHours = SchedulingHours.Working;
    templateState.setSelectedTemplateId(null);
    manualSlugEdit = false;
    editingId = null;
  }

  function getBookingUrl(slug: string): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/book/${slug}`;
    }
    return `/book/${slug}`;
  }

  async function copyUrl(slug: string) {
    const url = getBookingUrl(slug);
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    if (copyErrorTimer) clearTimeout(copyErrorTimer);
    try {
      await navigator.clipboard.writeText(url);
      copyFeedback = slug;
      copyError = null;
      copyFeedbackTimer = setTimeout(() => {
        copyFeedback = null;
      }, COPY_FEEDBACK_DURATION_MS);
    } catch {
      copyError = slug;
      copyFeedback = null;
      copyErrorTimer = setTimeout(() => {
        copyError = null;
      }, COPY_FEEDBACK_DURATION_MS);
    }
  }

  function openAddForm() {
    resetForm();
    showPanel = true;
  }

  function openEditForm(link: SchedulingLink) {
    editingId = link.id;
    formName = link.name;
    formSlug = link.slug;
    formPriority = link.priority;
    formDuration15 = link.durations.includes(15);
    formDuration30 = link.durations.includes(30);
    formDuration60 = link.durations.includes(60);
    formSchedulingHours = link.schedulingHours ?? SchedulingHours.Working;
    templateState.setSelectedTemplateId(null);
    manualSlugEdit = true;
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
        menuFocusIndex = -1;
        return;
      }
      if (confirmingDeleteId) {
        confirmingDeleteId = null;
        return;
      }
      if (showPanel) closePanel();
    }
  }

  function handleWindowClick() {
    if (menuOpenId) {
      menuOpenId = null;
      menuFocusIndex = -1;
    }
    if (confirmingDeleteId) confirmingDeleteId = null;
  }

  $effect(() => {
    if (menuFocusIndex >= 0 && menuItemEls[menuFocusIndex]) {
      menuItemEls[menuFocusIndex]!.focus();
    }
  });

  async function handleSubmit() {
    const durations: number[] = [];
    if (formDuration15) durations.push(15);
    if (formDuration30) durations.push(30);
    if (formDuration60) durations.push(60);

    if (durations.length === 0) {
      error = 'Select at least one duration.';
      return;
    }

    if (!SLUG_PATTERN.test(formSlug)) {
      slugError = 'Slug must contain only lowercase letters, numbers, and hyphens.';
      return;
    }
    slugError = '';

    submitting = true;

    const linkData = {
      name: formName.trim(),
      slug: formSlug.trim(),
      durations,
      priority: formPriority,
      schedulingHours: formSchedulingHours,
    };

    try {
      if (editingId) {
        await linksApi.update(editingId, linkData);
      } else {
        await linksApi.create(linkData);
      }
      const list = await linksApi.list();
      linkList = list as SchedulingLink[];
      showSuccess(editingId ? 'Link updated successfully.' : 'Link created successfully.');
      closePanel();
    } catch {
      if (editingId) {
        linkList = linkList.map((l) => (l.id === editingId ? { ...l, ...linkData } : l));
        showSuccess('Link updated (offline).');
      } else {
        linkList = [
          ...linkList,
          {
            id: crypto.randomUUID(),
            ...linkData,
            enabled: true,
            schedulingHours: formSchedulingHours,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as SchedulingLink,
        ];
        showSuccess('Link created (offline).');
      }
    } finally {
      submitting = false;
    }
  }

  async function toggleEnabled(link: SchedulingLink) {
    try {
      await linksApi.update(link.id, { enabled: !link.enabled });
      const list = await linksApi.list();
      linkList = list as SchedulingLink[];
    } catch {
      linkList = linkList.map((l) => (l.id === link.id ? { ...l, enabled: !l.enabled } : l));
    }
  }

  async function deleteLink(id: string) {
    try {
      await linksApi.delete(id);
      const list = await linksApi.list();
      linkList = list as SchedulingLink[];
      showSuccess('Link deleted successfully.');
    } catch {
      linkList = linkList.filter((l) => l.id !== id);
      showSuccess('Link deleted (offline).');
    }
    confirmingDeleteId = null;
  }

  function autoSlug() {
    if (manualSlugEdit) return;
    formSlug = formName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  onMount(async () => {
    loading = true;
    error = '';
    try {
      const list = await linksApi.list();
      linkList = list as SchedulingLink[];
    } catch (err) {
      if (err instanceof TypeError) {
        error = "You're offline — check your connection";
      } else {
        error = 'Could not load scheduling links.';
      }
    } finally {
      loading = false;
    }
    templateState.load();
  });
</script>

<svelte:head>
  <title>{pageTitle('Links')}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<div class="links-page">
  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">Scheduling Links</h1>
    <button onclick={openAddForm} class="btn-accent-pill" aria-haspopup="dialog">
      <Plus size={16} strokeWidth={1.5} />
      Add Link
    </button>
  </div>

  {#if error}
    <div class="alert-error" role="alert">{error}</div>
  {/if}
  <div class="sr-only" aria-live="polite">
    {#if copyFeedback}URL copied to clipboard{:else if copyError}Failed to copy URL{/if}
  </div>

  {#if loading}
    <div class="links-loading" role="status" aria-live="polite">
      <p class="text-secondary">Loading...</p>
    </div>
  {:else if linkList.length === 0}
    <!-- Empty State -->
    <div class="empty-state">
      <Link size={48} strokeWidth={1.5} style="color: var(--color-text-tertiary);" />
      <h2 class="empty-title">No links yet</h2>
      <p class="empty-desc">Create your first scheduling link to share with others</p>
      <button onclick={openAddForm} class="btn-accent-pill empty-cta">
        <Plus size={16} strokeWidth={1.5} />
        Add Link
      </button>
    </div>
  {:else}
    <!-- Table -->
    <div role="table" aria-label="Scheduling links">
      <div class="table-header table-grid" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Slug</span>
        <span role="columnheader">Durations</span>
        <span role="columnheader">Status</span>
        <span role="columnheader"><span class="sr-only">Copy</span></span>
        <span role="columnheader"><span class="sr-only">Actions</span></span>
      </div>

      {#each linkList as link (link.id)}
        <div
          class="table-row table-grid"
          onclick={() => openEditForm(link)}
          role="row"
          tabindex="0"
          aria-label="Edit {link.name}"
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openEditForm(link);
            }
          }}
        >
          <span role="cell" class="link-name">{link.name}</span>
          <span role="cell" class="link-slug font-mono">/{link.slug}</span>
          <span role="cell" class="link-durations">
            {#each link.durations as dur (dur)}
              <span class="duration-pill">{dur}m</span>
            {/each}
          </span>
          <span role="cell">
            <button
              class="toggle-btn"
              onclick={(e) => {
                e.stopPropagation();
                toggleEnabled(link);
              }}
              aria-label={link.enabled ? 'Disable link' : 'Enable link'}
            >
              {#if link.enabled}
                <ToggleRight size={20} strokeWidth={1.5} style="color: var(--color-accent);" />
              {:else}
                <ToggleLeft
                  size={20}
                  strokeWidth={1.5}
                  style="color: var(--color-text-tertiary);"
                />
              {/if}
            </button>
          </span>
          <span role="cell">
            <button
              class="row-action-btn"
              onclick={(e) => {
                e.stopPropagation();
                copyUrl(link.slug);
              }}
              aria-label="Copy URL"
            >
              {#if copyError === link.slug}
                <AlertCircle size={16} strokeWidth={1.5} style="color: var(--color-danger);" />
              {:else if copyFeedback === link.slug}
                <Check size={16} strokeWidth={1.5} style="color: var(--color-success);" />
              {:else}
                <Copy size={16} strokeWidth={1.5} />
              {/if}
            </button>
          </span>
          <span role="cell" class="kebab-cell">
            <KebabMenu
              open={menuOpenId === link.id}
              itemName={link.name}
              ontoggle={(open) => {
                menuFocusIndex = -1;
                menuOpenId = open ? link.id : null;
              }}
            >
              <button
                class="kebab-menu-item"
                role="menuitem"
                onclick={() => {
                  menuOpenId = null;
                  openEditForm(link);
                }}
              >
                <Pencil size={15} strokeWidth={1.5} />
                Edit
              </button>
              <button
                class="kebab-menu-item kebab-menu-item--danger"
                role="menuitem"
                onclick={() => {
                  menuOpenId = null;
                  confirmingDeleteId = link.id;
                  tick().then(() => document.getElementById('confirm-delete-yes')?.focus());
                }}
              >
                <Trash2 size={15} strokeWidth={1.5} />
                Delete
              </button>
            </KebabMenu>
            {#if confirmingDeleteId === link.id}
              <div
                class="confirm-delete"
                role="alertdialog"
                aria-label="Confirm deletion"
                aria-describedby="confirm-delete-label"
                tabindex="-1"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === 'Escape') confirmingDeleteId = null;
                }}
              >
                <span class="confirm-delete-text" id="confirm-delete-label">Delete this link?</span>
                <button
                  class="confirm-delete-yes"
                  id="confirm-delete-yes"
                  onclick={() => deleteLink(link.id)}>Yes</button
                >
                <button
                  class="confirm-delete-no"
                  onclick={() => {
                    confirmingDeleteId = null;
                  }}>No</button
                >
              </div>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Slide-over Panel -->
<SlideOverPanel open={showPanel} title={editingId ? 'Edit Link' : 'Add Link'} onclose={closePanel}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
    class="panel-body"
  >
    <div class="form-field">
      <label for="link-name">Name</label>
      <input
        id="link-name"
        type="text"
        bind:value={formName}
        oninput={autoSlug}
        required
        placeholder="e.g., Quick Chat"
      />
    </div>

    <div class="form-field">
      <label for="link-slug">Slug</label>
      <input
        id="link-slug"
        type="text"
        bind:value={formSlug}
        oninput={() => {
          manualSlugEdit = true;
          slugError = '';
        }}
        required
        placeholder="e.g., quick-chat"
        pattern="[a-z0-9\-]+"
        aria-invalid={slugError ? true : undefined}
        aria-describedby={slugError ? 'link-slug-error' : undefined}
      />
      {#if slugError}
        <span class="field-error" id="link-slug-error" role="alert">{slugError}</span>
      {/if}
    </div>

    <div class="form-field">
      <label for="link-priority">Priority</label>
      <select id="link-priority" bind:value={formPriority}>
        <option value={1}>P1 - Critical</option>
        <option value={2}>P2 - High</option>
        <option value={3}>P3 - Medium</option>
        <option value={4}>P4 - Low</option>
      </select>
    </div>

    <div class="form-field">
      <label for="link-sched">Schedule during</label>
      <select
        id="link-sched"
        value={templateState.getDropdownValue(formSchedulingHours)}
        onchange={(e) => handleScheduleDropdownChange(e.currentTarget.value)}
      >
        <option value="working">Work hours</option>
        <option value="personal">Personal hours</option>
        <option value="custom">Anytime (custom)</option>
        {#if schedulingTemplates.length > 0}
          <optgroup label="Templates">
            {#each schedulingTemplates as tmpl (tmpl.id)}
              <option value="template:{tmpl.id}"
                >{tmpl.name} ({tmpl.startTime}–{tmpl.endTime})</option
              >
            {/each}
          </optgroup>
        {/if}
      </select>
    </div>

    <fieldset class="form-field durations-fieldset">
      <legend class="durations-legend">Durations</legend>
      <div class="durations-row">
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formDuration15} />
          <span>15 min</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formDuration30} />
          <span>30 min</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" bind:checked={formDuration60} />
          <span>60 min</span>
        </label>
      </div>
    </fieldset>

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

  .links-loading {
    @include flex-center;
    padding: var(--space-12) 0;
  }

  .text-secondary {
    color: var(--color-text-secondary);
  }

  .empty-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
    margin-top: var(--space-4);
  }

  .empty-desc {
    color: var(--color-text-secondary);
    margin-top: var(--space-2);
  }

  .empty-cta {
    margin-top: var(--space-5);
  }

  .table-grid {
    grid-template-columns: 1fr 140px 160px 60px 40px 40px;
  }

  .link-name {
    font-weight: 500;
    color: var(--color-text);
  }

  .link-slug {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .link-durations {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .duration-pill {
    @include badge(var(--color-surface-hover), var(--color-text-secondary));
    font-weight: 500;
    font-family: $font-mono;
  }

  .field-error {
    font-size: 0.75rem;
    color: var(--color-danger);
  }

  .durations-fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }

  .durations-legend {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
    padding: 0;
    margin-bottom: var(--space-1);
  }

  .durations-row {
    display: flex;
    gap: var(--space-4);
    padding-top: var(--space-1);
  }

  .confirm-delete {
    @include dropdown-menu;
    top: 100%;
    right: 0;
    min-width: 160px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .confirm-delete-text {
    font-size: 0.8125rem;
    color: var(--color-text);
    white-space: nowrap;
  }

  .confirm-delete-yes {
    padding: var(--space-1) var(--space-3);
    background: var(--color-danger);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }

  .confirm-delete-no {
    padding: var(--space-1) var(--space-3);
    background: none;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    @include hover-surface;
  }

  @include mobile {
    .table-grid {
      grid-template-columns: 1fr 100px 120px 50px 36px 36px;
    }
  }

  @include small {
    .table-grid {
      grid-template-columns: 1fr 80px 40px 36px 36px;
    }
    .link-slug {
      display: none;
    }
  }
</style>
