<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import Search from 'lucide-svelte/icons/search';
  import { search } from '$lib/api';
  import { getCachedIndex, setCachedIndex } from '$lib/search-cache';
  import { parseQuery, getActivePrefix, getValidationError } from '$lib/search-parser';
  import { NAV_REGISTRY, SETTINGS_REGISTRY } from '$lib/search-registry';
  import { PRIORITY_LABELS, COLOR_NAMES, COLOR_BY_NAME } from '@fluxure/shared';
  import type { SearchIndex } from '@fluxure/shared';
  import type { ActivePrefix } from '$lib/search-parser';
  import type { NavItem } from '$lib/search-registry';

  let {
    open = false,
    onclose,
  }: {
    open?: boolean;
    onclose: () => void;
  } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let completionIdx = $state(0);
  let loading = $state(false);
  let index = $state<SearchIndex | null>(null);
  let inputEl: HTMLInputElement | undefined = $state();

  // ─── Types ──────────────────────────────────────────────────

  interface SearchResult {
    section: string;
    id: string;
    label: string;
    meta?: string;
    icon?: typeof import('lucide-svelte/icons/layout-dashboard').default;
    color?: string | null;
    priorityLabel?: string;
    href: string;
  }

  interface ResultSection {
    label: string;
    items: SearchResult[];
  }

  // ─── Completions map ────────────────────────────────────────

  const KNOWN_PREFIXES = ['type', 'priority', 'color', 'status', 'date', 'time', 'in'];

  const COMPLETIONS: Record<string, string[]> = {
    type: ['habit', 'task', 'event'],
    priority: ['critical', 'high', 'medium', 'low'],
    color: Object.values(COLOR_NAMES).map((n) => n.toLowerCase()),
    status: ['open', 'done', 'completed', 'scheduling', 'enabled', 'disabled'],
    date: ['today', 'tomorrow', 'this-week', 'next-week', 'this-month'],
    time: ['9am', '12pm', '2pm', '5pm'],
    in: ['settings', 'nav'],
  };

  // ─── Completion item types ────────────────────────────────

  interface CompletionItem {
    label: string;
    kind: 'prefix' | 'value' | 'suggestion';
  }

  // ─── Short priority labels ─────────────────────────────────

  const SHORT_PRIORITY: Record<string, string> = {
    critical: 'crit',
    high: 'high',
    medium: 'med',
    low: 'low',
  };

  function priorityShort(p: number): string {
    const label = PRIORITY_LABELS[p];
    return label ? (SHORT_PRIORITY[label] ?? label) : '';
  }

  // ─── On open effect ─────────────────────────────────────────

  $effect(() => {
    if (open) {
      query = '';
      selectedIndex = 0;

      const cached = getCachedIndex();
      if (cached) {
        index = cached;
      } else {
        loading = true;
        search
          .index()
          .then((data) => {
            index = data;
            setCachedIndex(data);
          })
          .catch(() => {
            index = null;
          })
          .finally(() => {
            loading = false;
          });
      }

      requestAnimationFrame(() => inputEl?.focus());
    }
  });

  // ─── Derived state ─────────────────────────────────────────

  let parsed = $derived(parseQuery(query));
  let activePrefix = $derived(getActivePrefix(query));

  let hasEntityFilter = $derived(
    parsed.type !== null ||
      parsed.priority !== null ||
      parsed.color !== null ||
      parsed.status !== null ||
      parsed.dateRange !== null ||
      parsed.timeMinutes !== null,
  );

  let completionItems = $derived.by((): CompletionItem[] => {
    // Active filter prefix with partial value (e.g., "type:h") → value completions
    if (activePrefix && activePrefix.prefix !== ':') {
      const candidates = COMPLETIONS[activePrefix.prefix] ?? [];
      const filtered = activePrefix.partial
        ? candidates.filter((c) => c.startsWith(activePrefix.partial))
        : candidates;
      return filtered.map((c) => ({ label: c, kind: 'value' as const }));
    }

    // No active prefix → check last token for prefix name or bare value matches
    if (!activePrefix) {
      const tokens = query.trim().split(/\s+/);
      const last = tokens[tokens.length - 1]?.toLowerCase();
      if (!last) return [];

      // Partial or exact prefix name: "ty" → "type:", "type" → "type:"
      const prefixMatches = KNOWN_PREFIXES.filter((p) => p.startsWith(last));
      if (prefixMatches.length > 0) {
        return prefixMatches.map((p) => ({ label: `${p}:`, kind: 'prefix' as const }));
      }

      // Bare values: "hab" → "type:habit", "crit" → "priority:critical"
      const suggestions: CompletionItem[] = [];
      for (const [prefix, values] of Object.entries(COMPLETIONS)) {
        for (const v of values) {
          if (v.startsWith(last)) {
            suggestions.push({ label: `${prefix}:${v}`, kind: 'suggestion' });
          }
        }
      }
      return suggestions;
    }

    return [];
  });

  let validationError = $derived.by(() => {
    if (!activePrefix || activePrefix.prefix === ':') return null;
    if (completionItems.length > 0) return null;
    return getValidationError(activePrefix.prefix, activePrefix.partial);
  });

  let guidanceMode = $derived.by((): string | null => {
    if (!query.trim()) return 'hint';
    if (activePrefix?.prefix === ':') return 'reference';
    if (completionItems.length > 0) return 'completions';
    if (activePrefix) {
      const error = getValidationError(activePrefix.prefix, activePrefix.partial);
      if (error) return 'error';
    }
    return null;
  });

  let resultSections = $derived.by((): ResultSection[] => {
    const sections: ResultSection[] = [];
    const ft = parsed.freeText.toLowerCase();
    const typeFilter = parsed.type;
    const sectionLimit = typeFilter ? Infinity : 5;

    // 1. Navigation — skip if scope is 'settings' or entity filters active
    if (parsed.scope !== 'settings' && (!hasEntityFilter || parsed.scope === 'nav')) {
      const navItems: SearchResult[] = NAV_REGISTRY.filter(
        (n: NavItem) => !ft || n.label.toLowerCase().includes(ft),
      )
        .slice(0, sectionLimit)
        .map((n: NavItem) => ({
          section: 'Navigation',
          id: n.href,
          label: n.label,
          icon: n.icon,
          href: n.href,
        }));
      if (navItems.length > 0) {
        sections.push({ label: 'Navigation', items: navItems });
      }
    }

    // 2. Settings — skip if scope is 'nav' or entity filters active
    if (parsed.scope !== 'nav' && (!hasEntityFilter || parsed.scope === 'settings')) {
      const settingsItems: SearchResult[] = SETTINGS_REGISTRY.filter((s) => {
        if (!ft) return true;
        return (
          s.label.toLowerCase().includes(ft) || s.keywords.some((k) => k.toLowerCase().includes(ft))
        );
      })
        .slice(0, sectionLimit)
        .map((s) => ({
          section: 'Settings',
          id: s.id,
          label: s.label,
          icon: s.icon,
          meta: s.tab,
          href: `/settings?tab=${s.tab}&highlight=${s.id}`,
        }));
      if (settingsItems.length > 0) {
        sections.push({ label: 'Settings', items: settingsItems });
      }
    }

    if (!index) return sections;

    // 3. Habits
    if (!parsed.scope && (!typeFilter || typeFilter === 'habit')) {
      if (!parsed.dateRange && parsed.timeMinutes === null) {
        const habitItems: SearchResult[] = index.habits
          .filter((h) => {
            if (parsed.priority !== null && h.priority !== parsed.priority) return false;
            if (parsed.color !== null && h.color !== parsed.color) return false;
            if (parsed.status !== null) {
              if (parsed.status.field === 'enabled' && h.enabled !== parsed.status.value)
                return false;
              if (parsed.status.field === 'status') return false; // habits don't have status field
            }
            if (ft && !h.name.toLowerCase().includes(ft)) return false;
            return true;
          })
          .slice(0, sectionLimit)
          .map((h) => ({
            section: 'Habits',
            id: h.id,
            label: h.name,
            color: h.color,
            priorityLabel: priorityShort(h.priority),
            meta: h.days.length === 7 ? 'Daily' : h.days.join(', '),
            href: `/habits?edit=${h.id}`,
          }));
        if (habitItems.length > 0) {
          sections.push({ label: 'Habits', items: habitItems });
        }
      }
    }

    // 4. Tasks
    if (!parsed.scope && (!typeFilter || typeFilter === 'task')) {
      const taskItems: SearchResult[] = index.tasks
        .filter((t) => {
          if (parsed.priority !== null && t.priority !== parsed.priority) return false;
          if (parsed.color !== null && t.color !== parsed.color) return false;
          if (parsed.status !== null) {
            if (parsed.status.field === 'enabled' && t.enabled !== parsed.status.value)
              return false;
            if (parsed.status.field === 'status' && Array.isArray(parsed.status.value)) {
              if (!t.status || !parsed.status.value.includes(t.status)) return false;
            }
          }
          if (parsed.dateRange !== null) {
            if (!t.dueDate) return false;
            const due = new Date(t.dueDate);
            if (due < parsed.dateRange[0] || due > parsed.dateRange[1]) return false;
          }
          if (parsed.timeMinutes !== null) return false; // tasks don't have times
          if (ft && !t.name.toLowerCase().includes(ft)) return false;
          return true;
        })
        .slice(0, sectionLimit)
        .map((t) => ({
          section: 'Tasks',
          id: t.id,
          label: t.name,
          color: t.color,
          priorityLabel: t.priority !== null ? priorityShort(t.priority) : undefined,
          meta: t.dueDate ? formatShortDate(t.dueDate) : undefined,
          href: `/tasks?edit=${t.id}`,
        }));
      if (taskItems.length > 0) {
        sections.push({ label: 'Tasks', items: taskItems });
      }
    }

    // 5. Events — future only unless date: filter is active
    if (!parsed.scope && (!typeFilter || typeFilter === 'event')) {
      if (parsed.priority === null && parsed.color === null && parsed.status === null) {
        const now = new Date();
        const eventItems: SearchResult[] = index.events
          .filter((ev) => {
            const evEnd = new Date(ev.end);
            if (parsed.dateRange !== null) {
              // Date filter active: scope to the index window (past 7d – future 30d)
              const evStart = new Date(ev.start);
              if (evEnd < parsed.dateRange[0] || evStart > parsed.dateRange[1]) return false;
            } else {
              // No date filter: only show future events
              if (evEnd < now) return false;
            }
            if (parsed.timeMinutes !== null) {
              const evStart = new Date(ev.start);
              const evMinutes = evStart.getHours() * 60 + evStart.getMinutes();
              if (Math.abs(evMinutes - parsed.timeMinutes) > 30) return false;
            }
            if (ft && !ev.title.toLowerCase().includes(ft)) return false;
            return true;
          })
          .slice(0, sectionLimit)
          .map((ev) => ({
            section: 'Events',
            id: ev.id,
            label: ev.title,
            meta: formatEventMeta(ev.start, ev.end),
            href: `/?event=${ev.id}&estart=${encodeURIComponent(ev.start)}`,
          }));
        if (eventItems.length > 0) {
          sections.push({ label: 'Events', items: eventItems });
        }
      }
    }

    return sections;
  });

  let totalItems = $derived(resultSections.reduce((sum, s) => sum + s.items.length, 0));

  // ─── Auto-scroll active item into view ─────────────────────

  $effect(() => {
    // Track selectedIndex reactively
    const idx = selectedIndex;
    requestAnimationFrame(() => {
      const el = document.querySelector('.palette-item-active');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  // ─── Formatting helpers ─────────────────────────────────────

  function formatShortDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatEventMeta(startStr: string, endStr: string): string {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const datePart = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const startTime = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    });
    const endTime = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    });
    return `${datePart} \u00B7 ${startTime}\u2013${endTime}`;
  }

  // ─── Tab completion ─────────────────────────────────────────

  function applyCompletionItem(item: CompletionItem) {
    const tokens = query.trim().split(/\s+/);
    if (tokens.length === 0) return;

    if (item.kind === 'prefix') {
      // Replace last token with prefix + colon (e.g., "ty" → "type:")
      tokens[tokens.length - 1] = item.label;
      query = tokens.join(' ');
    } else if (item.kind === 'value') {
      // Complete value after colon (e.g., "type:h" → "type:habit")
      const last = tokens[tokens.length - 1];
      const colonIdx = last.indexOf(':');
      if (colonIdx >= 0) {
        tokens[tokens.length - 1] = `${last.slice(0, colonIdx + 1)}${item.label}`;
      }
      query = tokens.join(' ') + ' ';
    } else {
      // Suggestion: replace last token with full prefix:value
      tokens[tokens.length - 1] = item.label;
      query = tokens.join(' ') + ' ';
    }

    completionIdx = 0;
    selectedIndex = 0;
    requestAnimationFrame(() => inputEl?.focus());
  }

  // ─── Global index computation ───────────────────────────────

  function getGlobalIndex(sectionIdx: number, itemIdx: number): number {
    let count = 0;
    for (let s = 0; s < sectionIdx; s++) {
      count += resultSections[s].items.length;
    }
    return count + itemIdx;
  }

  // ─── Navigation ─────────────────────────────────────────────

  function navigateTo(href: string) {
    onclose();
    goto(href);
  }

  // ─── Keyboard handling ──────────────────────────────────────

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, totalItems - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Tab') {
      if (completionItems.length > 0) {
        e.preventDefault();
        if (e.shiftKey) {
          completionIdx = (completionIdx - 1 + completionItems.length) % completionItems.length;
        } else {
          applyCompletionItem(completionItems[completionIdx]);
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Find item at selectedIndex
      let remaining = selectedIndex;
      for (const section of resultSections) {
        if (remaining < section.items.length) {
          navigateTo(section.items[remaining].href);
          return;
        }
        remaining -= section.items.length;
      }
    }
  }
</script>

{#if open}
  <div
    class="palette-backdrop"
    role="presentation"
    onclick={onclose}
    transition:fade={{ duration: 120 }}
  ></div>
  <div
    class="palette"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Command palette"
    onkeydown={handleKeydown}
    transition:fly={{ y: -12, duration: 150 }}
  >
    <div class="palette-input-row">
      <Search size={16} />
      <input
        bind:this={inputEl}
        bind:value={query}
        oninput={() => {
          selectedIndex = 0;
          completionIdx = 0;
        }}
        type="text"
        placeholder="Search or jump to..."
        class="palette-input"
        role="combobox"
        aria-controls="search-results"
        aria-expanded={totalItems > 0}
        aria-autocomplete="list"
        aria-activedescendant={totalItems > 0 ? `search-result-${selectedIndex}` : undefined}
      />
      <kbd class="palette-kbd">esc</kbd>
    </div>

    {#if guidanceMode === 'hint'}
      <div class="palette-guidance">
        Try <code>type:</code> <code>priority:</code> <code>date:</code> <code>color:</code>
        <code>status:</code> <code>in:</code> or just start typing
      </div>
    {:else if guidanceMode === 'reference'}
      <div class="palette-guidance palette-reference">
        <div class="palette-ref-row"><code>type:</code> <span>habit, task, event</span></div>
        <div class="palette-ref-row">
          <code>priority:</code> <span>low, medium, high, critical</span>
        </div>
        <div class="palette-ref-row">
          <code>color:</code> <span>blue, red, green, purple...</span>
        </div>
        <div class="palette-ref-row">
          <code>status:</code> <span>open, done, enabled, disabled</span>
        </div>
        <div class="palette-ref-row">
          <code>date:</code> <span>today, tomorrow, this-week...</span>
        </div>
        <div class="palette-ref-row"><code>time:</code> <span>9am, 2:30pm, 14:00</span></div>
        <div class="palette-ref-row"><code>in:</code> <span>settings, nav</span></div>
      </div>
    {:else if guidanceMode === 'completions'}
      <div class="palette-guidance">
        {#each completionItems as item, i (item.label)}
          <button
            class="palette-pill"
            class:palette-pill-active={i === completionIdx}
            onclick={() => applyCompletionItem(item)}>{item.label}</button
          >
        {/each}
        <span class="palette-tab-hint">Tab</span>
      </div>
    {:else if guidanceMode === 'error'}
      <div class="palette-guidance palette-guidance-error">{validationError}</div>
    {/if}

    <div class="palette-body" id="search-results" role="listbox" aria-label="Search results">
      {#each resultSections as section, sectionIdx (section.label)}
        {#if section.items.length > 0}
          <div class="palette-section">
            <span class="palette-section-label">{section.label}</span>
            {#each section.items as item, itemIdx (item.id)}
              <button
                class="palette-item"
                class:palette-item-active={getGlobalIndex(sectionIdx, itemIdx) === selectedIndex}
                id="search-result-{getGlobalIndex(sectionIdx, itemIdx)}"
                onclick={() => navigateTo(item.href)}
                role="option"
                aria-selected={getGlobalIndex(sectionIdx, itemIdx) === selectedIndex}
              >
                {#if item.icon}
                  {@const Icon = item.icon}
                  <Icon size={15} />
                {/if}
                {#if item.color}
                  <span class="palette-color-dot" style="background:{item.color}"></span>
                {/if}
                <span class="palette-item-label">{item.label}</span>
                {#if item.priorityLabel}
                  <span class="palette-priority palette-priority-{item.priorityLabel}"
                    >{item.priorityLabel}</span
                  >
                {/if}
                {#if item.meta}
                  <span class="palette-item-meta">{item.meta}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      {/each}

      {#if loading}
        <div class="palette-empty">Loading...</div>
      {:else if query.trim() && totalItems === 0 && !guidanceMode}
        <div class="palette-empty">No results for &ldquo;{query}&rdquo;</div>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .palette-backdrop {
    @include backdrop;
    background: var(--color-overlay);
  }

  .palette {
    position: fixed;
    top: 18%;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 520px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    z-index: $z-modal;
    overflow: hidden;
  }

  .palette-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-separator);

    :global(svg) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .palette-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: $font-body;
    font-size: 0.875rem;
    outline: none;
    box-shadow: none;

    &::placeholder {
      color: var(--color-text-tertiary);
    }

    &:focus,
    &:focus-visible {
      border: none;
      box-shadow: none;
      outline: none;
    }
  }

  .palette-kbd {
    font-family: $font-mono;
    font-size: 0.5625rem;
    color: var(--color-text-tertiary);
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 1px 5px;
    line-height: 1.4;
  }

  .palette-guidance {
    padding: var(--space-2) var(--space-4);
    color: var(--color-text-tertiary);
    font-size: 0.75rem;
    border-bottom: 1px solid var(--color-separator);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    line-height: 1.6;

    code {
      background: var(--color-surface-hover);
      border-radius: var(--radius-sm);
      padding: 1px 4px;
      font-family: $font-mono;
      font-size: 0.6875rem;
    }
  }

  .palette-reference {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1px 16px;
  }

  .palette-ref-row {
    display: flex;
    gap: 4px;
    align-items: baseline;
    white-space: nowrap;

    span {
      color: var(--color-text-tertiary);
      opacity: 0.7;
    }
  }

  .palette-guidance-error {
    color: var(--color-error, #ea4335);
  }

  .palette-tab-hint {
    font-family: $font-mono;
    font-size: 0.5625rem;
    color: var(--color-text-tertiary);
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 1px 5px;
    line-height: 1.4;
    opacity: 0.6;
    margin-left: auto;
  }

  .palette-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: 2px 8px;
    font-size: 0.6875rem;
    font-family: $font-body;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast);

    &:hover,
    &.palette-pill-active {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &.palette-pill-active {
      border-color: var(--color-text-tertiary);
    }
  }

  .palette-body {
    max-height: 340px;
    overflow-y: auto;
    padding: var(--space-1) 0;
  }

  .palette-section {
    padding: var(--space-1) 0;
  }

  .palette-section-label {
    display: block;
    padding: var(--space-1) var(--space-4);
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: 6px var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: $font-body;
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);

    :global(svg) {
      opacity: 0.5;
      flex-shrink: 0;
    }

    &:hover,
    &.palette-item-active {
      background: var(--color-surface-hover);
      color: var(--color-text);

      :global(svg) {
        opacity: 0.8;
      }
    }
  }

  .palette-item-type {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    min-width: 48px;
  }

  .palette-item-label {
    flex: 1;
  }

  .palette-item-meta {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .palette-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }

  .palette-priority {
    font-size: 0.5625rem;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: var(--radius-full);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .palette-priority-low {
    background: var(--color-surface-hover);
    color: var(--color-text-tertiary);
  }

  .palette-priority-med {
    background: rgba(66, 133, 244, 0.12);
    color: #4285f4;
  }

  .palette-priority-high {
    background: rgba(255, 109, 1, 0.12);
    color: #ff6d01;
  }

  .palette-priority-crit {
    background: rgba(234, 67, 53, 0.12);
    color: #ea4335;
  }

  .palette-empty {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }
</style>
