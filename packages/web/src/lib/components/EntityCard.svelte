<script lang="ts">
  import type { Snippet } from 'svelte';
  import Trash2 from 'lucide-svelte/icons/trash-2';

  let {
    name,
    color = 'var(--color-accent)',
    paused = false,
    index = 0,
    confirmingDelete = false,
    onclick,
    ondelete,
    onconfirmdelete,
    oncanceldelete,
    chips,
    footer,
    detail,
  }: {
    name: string;
    color?: string;
    paused?: boolean;
    index?: number;
    confirmingDelete?: boolean;
    onclick: () => void;
    ondelete: () => void;
    onconfirmdelete: () => void;
    oncanceldelete: () => void;
    chips?: Snippet;
    footer?: Snippet;
    detail?: Snippet;
  } = $props();
</script>

<div
  class="entity-card card-enter"
  class:entity-paused={paused}
  style="--entity-color: {color}; --i: {index}"
  role="button"
  tabindex="0"
  {onclick}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onclick();
    }
  }}
>
  <div class="entity-top">
    <span class="entity-color-bar"></span>
    <div class="entity-info">
      <span class="entity-name">{name}</span>
      {#if chips}
        <div class="entity-meta">
          {@render chips()}
        </div>
      {/if}
    </div>
  </div>

  {#if detail}
    <div class="entity-detail">
      {@render detail()}
    </div>
  {/if}

  <div class="entity-footer" role="presentation" onclick={(e) => e.stopPropagation()}>
    {#if footer}
      {@render footer()}
    {:else}
      <div></div>
    {/if}
    <div class="entity-actions">
      {#if confirmingDelete}
        <button class="entity-action entity-action-danger" onclick={onconfirmdelete}>
          Delete?
        </button>
        <button class="entity-action" onclick={oncanceldelete}> No </button>
      {:else}
        <button
          class="entity-action entity-action-delete"
          onclick={ondelete}
          aria-label="Delete {name}"
        >
          <Trash2 size={13} />
        </button>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .entity-card {
    @include flex-col(var(--space-3));
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition:
      border-color var(--transition-fast),
      box-shadow var(--transition-fast);

    &:hover {
      border-color: var(--color-border-strong);
      box-shadow: var(--shadow-sm);

      .entity-actions {
        opacity: 1;
      }
    }
  }

  .entity-paused {
    opacity: 0.55;

    &:hover {
      opacity: 0.8;
    }
  }

  .entity-top {
    display: flex;
    gap: var(--space-3);
  }

  .entity-color-bar {
    width: 3px;
    border-radius: 2px;
    background: var(--entity-color);
    flex-shrink: 0;
    align-self: stretch;
  }

  .entity-info {
    @include flex-col(var(--space-2));
    min-width: 0;
    flex: 1;
  }

  .entity-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text);
    @include text-truncate;
  }

  .entity-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .entity-detail {
    display: flex;
    justify-content: space-between;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    padding-top: var(--space-1);
    border-top: 1px solid var(--color-separator);
  }

  .entity-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .entity-actions {
    display: flex;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .entity-action {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-tertiary);
    font-family: $font-body;
    font-size: 0.6875rem;
    cursor: pointer;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }
  }

  .entity-action-delete {
    margin-left: auto;

    &:hover {
      color: var(--color-danger);
      background: var(--color-danger-muted);
    }
  }

  .entity-action-danger {
    color: var(--color-danger);
    background: var(--color-danger-muted);

    &:hover {
      background: var(--color-danger);
      color: white;
    }
  }
</style>
