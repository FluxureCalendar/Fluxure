<script lang="ts">
  import { onMount } from 'svelte';
  import { pageTitle } from '$lib/brand';
  import { links } from '$lib/api';
  import type { SchedulingLink } from '@fluxure/shared';
  import { showToast } from '$lib/toast.svelte';
  import { formatDuration } from '$lib/utils/format';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import SlideOverPanel from '$lib/components/SlideOverPanel.svelte';

  import Plus from 'lucide-svelte/icons/plus';
  import Copy from 'lucide-svelte/icons/copy';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import ExternalLink from 'lucide-svelte/icons/external-link';

  let linkList = $state<SchedulingLink[]>([]);
  let loading = $state(true);
  let formOpen = $state(false);
  let loadError = $state('');

  // Form state
  let formName = $state('');
  let formSlug = $state('');
  let formDurations = $state('15, 30, 60');
  let saving = $state(false);

  async function loadLinks() {
    try {
      loadError = '';
      linkList = await links.list();
    } catch (err) {
      console.error('Failed to load links:', err);
      loadError = 'Failed to load links. Please try again.';
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    formName = '';
    formSlug = '';
    formDurations = '15, 30, 60';
    formOpen = true;
  }

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault();
    if (!formName.trim() || !formSlug.trim() || saving) return;

    saving = true;
    try {
      const durations = formDurations
        .split(',')
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n) && n > 0);

      await links.create({
        name: formName.trim(),
        slug: formSlug.trim(),
        durations,
      });
      showToast('Link created', 'success');
      formOpen = false;
      await loadLinks();
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to create link', 'error');
      }
    } finally {
      saving = false;
    }
  }

  async function deleteLink(link: SchedulingLink) {
    try {
      await links.delete(link.id);
      linkList = linkList.filter((l) => l.id !== link.id);
      showToast('Link deleted', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to delete link', 'error');
      }
    }
  }

  async function copyUrl(slug: string) {
    const url = `${window.location.origin}/book/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  }

  onMount(() => {
    loadLinks();
  });
</script>

<svelte:head>
  <title>{pageTitle('Links')}</title>
</svelte:head>

<PageHeader title="Links" subtitle="Shareable booking pages for scheduling with others">
  {#if !loading && linkList.length > 0}
    <button class="btn-primary" onclick={openCreate}>
      <Plus size={16} /> Create link
    </button>
  {/if}
</PageHeader>

{#if !loading}
  {#if loadError}
    <div class="load-error">
      <p>{loadError}</p>
      <button onclick={loadLinks}>Retry</button>
    </div>
  {:else if linkList.length === 0}
    <EmptyState
      icon={ExternalLink}
      title="No scheduling links"
      message="Create a public link so others can book time with you."
      actionLabel="Create link"
      onaction={openCreate}
    />
  {:else}
    <div class="links-grid">
      {#each linkList as link, i (link.id)}
        <div class="link-card card-enter" style="--i: {i}">
          <div class="link-header">
            <h3 class="link-name">{link.name}</h3>
            <div class="link-actions">
              <button
                class="icon-action"
                onclick={() => copyUrl(link.slug)}
                aria-label="Copy link URL"
              >
                <Copy size={16} />
              </button>
              <button
                class="icon-action icon-danger"
                onclick={() => deleteLink(link)}
                aria-label="Delete link"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <div class="link-slug">
            <ExternalLink size={12} />
            /book/{link.slug}
          </div>
          <div class="link-durations">
            {#each link.durations as d (d)}
              <span class="duration-tag">{formatDuration(d)}</span>
            {/each}
          </div>
          {#if !link.enabled}
            <span class="badge-amber">Disabled</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

<SlideOverPanel
  open={formOpen}
  title="New booking link"
  onclose={() => {
    formOpen = false;
  }}
>
  <form class="link-form" onsubmit={handleCreate}>
    <div class="form-field">
      <label class="form-label" for="link-name">Name</label>
      <input
        id="link-name"
        class="form-input"
        bind:value={formName}
        placeholder="30-min meeting"
        required
      />
    </div>
    <div class="form-field">
      <label class="form-label" for="link-slug">URL slug</label>
      <input id="link-slug" class="form-input" bind:value={formSlug} placeholder="30min" required />
    </div>
    <div class="form-field">
      <label class="form-label" for="link-durations">Durations (comma-separated, minutes)</label>
      <input
        id="link-durations"
        class="form-input"
        bind:value={formDurations}
        placeholder="15, 30, 60"
      />
    </div>
    <div class="slideover-footer">
      <button
        type="button"
        class="btn-secondary"
        onclick={() => {
          formOpen = false;
        }}>Cancel</button
      >
      <button
        type="submit"
        class="btn-primary"
        disabled={saving || !formName.trim() || !formSlug.trim()}
      >
        {saving ? 'Creating...' : 'Create'}
      </button>
    </div>
  </form>
</SlideOverPanel>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .links-grid {
    @include flex-col(var(--space-3));
  }

  .link-card {
    @include flex-col(var(--space-1));
    padding: var(--space-4);
    border: 1px solid var(--color-separator);
    border-radius: var(--radius-lg);
    transition: border-color var(--transition-fast);

    &:hover {
      border-color: var(--color-border);
    }
  }

  .link-header {
    @include flex-between;
  }

  .link-name {
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .link-actions {
    display: flex;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity var(--transition-fast);
    .link-card:hover & {
      opacity: 0.6;
    }
    .link-card:hover &:hover {
      opacity: 1;
    }
  }

  .icon-action {
    @include icon-btn(28px);
  }

  .icon-danger {
    &:hover {
      color: var(--color-danger);
      background: var(--color-danger-muted);
    }
  }

  .link-slug {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    font-family: $font-mono;
    opacity: 0.6;
  }

  .link-durations {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-top: var(--space-1);
  }

  .duration-tag {
    font-size: 0.6875rem;
    color: var(--color-accent);
    opacity: 0.7;
  }

  .link-form {
    @include flex-col(var(--space-4));
  }
</style>
