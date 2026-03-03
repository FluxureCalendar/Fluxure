<script lang="ts">
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { SEARCH_MIN_QUERY_LENGTH, SEARCH_DEBOUNCE_MS } from '@fluxure/shared';
  import { search as searchApi } from '$lib/api';
  import Search from 'lucide-svelte/icons/search';
  import Loader from 'lucide-svelte/icons/loader';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Repeat from 'lucide-svelte/icons/repeat';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Users from 'lucide-svelte/icons/users';

  let { open = $bindable(false) } = $props();

  let searchQuery = $state('');
  let searchResults = $state<Array<{ type: string; id: string; name: string; href: string }>>([]);
  let searchLoading = $state(false);
  let searchError = $state('');
  let selectedIndex = $state(-1);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let searchAbortController: AbortController | undefined;
  let previousFocus: HTMLElement | null = null;
  let searchInputEl: HTMLInputElement | undefined = $state();

  const typeIcons: Record<string, typeof Repeat> = {
    habit: Repeat,
    task: CheckSquare,
    meeting: Users,
  };

  const ALLOWED_ROUTE_PREFIXES = [
    '/habits',
    '/tasks',
    '/meetings',
    '/focus',
    '/links',
    '/analytics',
    '/settings',
    '/dashboard',
    '/privacy',
    '/book',
  ];

  export function openSearch() {
    previousFocus = document.activeElement as HTMLElement | null;
    open = true;
    searchQuery = '';
    searchResults = [];
    searchLoading = false;
    searchError = '';
    selectedIndex = -1;
    tick().then(() => searchInputEl?.focus());
  }

  export function closeSearch() {
    open = false;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchAbortController?.abort();
    searchAbortController = undefined;
    previousFocus?.focus();
    previousFocus = null;
  }

  function handleSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchAbortController?.abort();
    const q = searchQuery.trim();
    if (q.length < SEARCH_MIN_QUERY_LENGTH) {
      searchResults = [];
      searchLoading = false;
      searchError = '';
      return;
    }
    searchLoading = true;
    searchError = '';
    const controller = new AbortController();
    searchAbortController = controller;
    searchDebounceTimer = setTimeout(async () => {
      try {
        const data = await searchApi.query(q);
        if (controller.signal.aborted) return;
        searchResults = data.results;
      } catch {
        if (controller.signal.aborted) return;
        searchResults = [];
        searchError = 'Search failed. Please try again.';
      } finally {
        if (!controller.signal.aborted) {
          searchLoading = false;
        }
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function selectResult(result: { href: string }) {
    closeSearch();
    if (
      result.href &&
      result.href.startsWith('/') &&
      (result.href === '/' || ALLOWED_ROUTE_PREFIXES.some((p) => result.href.startsWith(p)))
    ) {
      goto(resolve(result.href as '/'));
    }
  }

  function handleSearchDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex =
        searchResults.length > 0 ? Math.min(selectedIndex + 1, searchResults.length - 1) : -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < searchResults.length) {
      e.preventDefault();
      selectResult(searchResults[selectedIndex]);
    } else if (e.key === 'Tab') {
      const dialog = e.currentTarget as HTMLElement;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      // If only one focusable element (the input), close dialog instead of trapping
      if (focusable.length <= 1) {
        e.preventDefault();
        closeSearch();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  export function cleanup() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchAbortController?.abort();
  }
</script>

{#if open}
  <!-- Command Palette Backdrop -->
  <button class="search-backdrop" onclick={closeSearch} aria-label="Close search" tabindex="-1"
  ></button>

  <!-- Command Palette Dialog -->
  <div
    class="search-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Search"
    tabindex="-1"
    onkeydown={handleSearchDialogKeydown}
  >
    <div class="search-input-row">
      <Search size={18} strokeWidth={1.5} />
      <input
        class="search-input"
        type="text"
        placeholder="Search habits, tasks, meetings..."
        bind:value={searchQuery}
        bind:this={searchInputEl}
        oninput={handleSearchInput}
        role="combobox"
        aria-expanded={searchResults.length > 0}
        aria-controls="search-listbox"
        aria-activedescendant={selectedIndex >= 0 ? `search-option-${selectedIndex}` : undefined}
      />
      <kbd class="search-kbd">Esc</kbd>
    </div>

    <div class="search-results" id="search-listbox" role="listbox" aria-label="Search results">
      {#if searchLoading}
        <div class="search-empty">
          <Loader size={18} strokeWidth={1.5} class="spin" />
          <span>Searching...</span>
        </div>
      {:else if searchError}
        <div class="search-empty search-empty--error">{searchError}</div>
      {:else if searchResults.length > 0}
        {#each searchResults as result, i (result.id)}
          {@const Icon = typeIcons[result.type] || Calendar}
          <div
            class="search-result"
            class:selected={i === selectedIndex}
            id="search-option-{i}"
            role="option"
            tabindex="-1"
            aria-selected={i === selectedIndex}
            onclick={() => selectResult(result)}
          >
            <Icon size={16} strokeWidth={1.5} />
            <span class="search-result-name">{result.name}</span>
            <span class="search-result-type">{result.type}</span>
          </div>
        {/each}
      {:else}
        <div class="search-hint">
          {#if searchQuery.trim().length >= 2}
            <span class="search-hint-text">no matches</span>
          {:else}
            <div class="search-hint-shortcuts">
              <div class="search-hint-row">
                <span class="search-hint-keys"><kbd>↑</kbd><kbd>↓</kbd></span>
                <span class="search-hint-label">navigate</span>
              </div>
              <div class="search-hint-row">
                <span class="search-hint-keys"><kbd>↵</kbd></span>
                <span class="search-hint-label">open</span>
              </div>
              <div class="search-hint-row">
                <span class="search-hint-keys"><kbd>esc</kbd></span>
                <span class="search-hint-label">close</span>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .search-backdrop {
    @include backdrop(0.5);
    z-index: $z-overlay;
  }

  .search-dialog {
    position: fixed;
    top: 20%;
    left: 50%;
    transform: translateX(-50%);
    width: 90vw;
    max-width: 560px;
    max-height: 420px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: $z-modal;
    @include flex-col;
    overflow: hidden;
  }

  .search-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-secondary);
  }

  .search-input {
    flex: 1;
    border: none;
    background: none;
    font-size: 0.9375rem;
    font-family: inherit;
    color: var(--color-text);
    outline: none;

    &::placeholder {
      color: var(--color-text-tertiary);
    }
  }

  .search-kbd {
    font-family: $font-mono;
    font-size: 0.6875rem;
    padding: 1px 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2) 0;
  }

  .search-empty {
    @include flex-center;
    gap: var(--space-2);
    padding: var(--space-6);
    color: var(--color-text-tertiary);
    font-size: 0.875rem;

    &--error {
      color: var(--color-text-error);
    }
  }

  .search-hint {
    @include flex-center;
    padding: var(--space-6) var(--space-4);
  }

  .search-hint-text {
    font-size: 0.875rem;
    font-family: $font-mono;
    color: var(--color-text-tertiary);
    letter-spacing: 0.05em;
  }

  .search-hint-shortcuts {
    display: flex;
    gap: var(--space-6);
  }

  .search-hint-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .search-hint-keys {
    display: flex;
    gap: 2px;

    kbd {
      font-family: $font-mono;
      font-size: 0.6875rem;
      padding: 2px 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-secondary);
      background: var(--color-bg-secondary, transparent);
      line-height: 1.4;
    }
  }

  .search-hint-label {
    font-size: 0.6875rem;
    font-family: $font-mono;
    color: var(--color-text-tertiary);
    letter-spacing: 0.03em;
  }

  .search-result {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: none;
    background: none;
    color: var(--color-text);
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  .search-result-name {
    flex: 1;
    @include text-truncate;
  }

  .search-result-type {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    text-transform: capitalize;
    flex-shrink: 0;
  }

  .search-result.selected {
    background: var(--color-surface-hover);
  }
</style>
