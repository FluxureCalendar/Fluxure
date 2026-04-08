<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { settings } from '$lib/api';
  import type { UserConfig } from '@fluxure/shared';
  import { getCachedSettings, setCachedSettings } from '$lib/cache.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Search from 'lucide-svelte/icons/search';
  import Globe from 'lucide-svelte/icons/globe';
  import TimeRangeSlider from '$lib/components/TimeRangeSlider.svelte';
  import DurationSlider from '$lib/components/DurationSlider.svelte';
  import { getAuthState } from '$lib/auth.svelte';
  import {
    getPlanLimits,
    DEFAULT_BREAK_BETWEEN_MINUTES,
    DEFAULT_SCHEDULING_WINDOW_DAYS,
  } from '@fluxure/shared';

  let {
    ondirtychange,
  }: {
    ondirtychange?: (dirty: boolean) => void;
  } = $props();

  const userPlan = $derived(getAuthState().user?.plan ?? 'free');
  const planLimits = $derived(getPlanLimits(userPlan));

  let config = $state<UserConfig | null>(null);
  let loading = $state(true);
  let saving = $state(false);

  // Track original values for dirty detection
  let origTimezone = $state('');
  let origWorkStart = $state('');
  let origWorkEnd = $state('');
  let origPersonalStart = $state('');
  let origPersonalEnd = $state('');
  let origFreeSlotOnComplete = $state(false);
  let origSchedulingWindowDays = $state(DEFAULT_SCHEDULING_WINDOW_DAYS);
  let origTrimCompletedEvents = $state(true);
  let origBreakBetweenItemsMinutes = $state(DEFAULT_BREAK_BETWEEN_MINUTES);
  let origAutoCompleteHabits = $state(true);

  let timezone = $state('');
  let workStart = $state('09:00');
  let workEnd = $state('17:00');
  let personalStart = $state('17:00');
  let personalEnd = $state('22:00');
  let freeSlotOnComplete = $state(false);
  let schedulingWindowDays = $state(DEFAULT_SCHEDULING_WINDOW_DAYS);
  let trimCompletedEvents = $state(true);
  let breakBetweenItemsMinutes = $state(DEFAULT_BREAK_BETWEEN_MINUTES);
  let autoCompleteHabits = $state(true);

  let isDirty = $derived(
    timezone !== origTimezone ||
      workStart !== origWorkStart ||
      workEnd !== origWorkEnd ||
      personalStart !== origPersonalStart ||
      personalEnd !== origPersonalEnd ||
      freeSlotOnComplete !== origFreeSlotOnComplete ||
      schedulingWindowDays !== origSchedulingWindowDays ||
      trimCompletedEvents !== origTrimCompletedEvents ||
      breakBetweenItemsMinutes !== origBreakBetweenItemsMinutes ||
      autoCompleteHabits !== origAutoCompleteHabits,
  );

  // Notify parent of dirty state changes
  $effect(() => {
    ondirtychange?.(isDirty);
  });

  // Warn before navigating away with unsaved changes
  beforeNavigate(({ cancel }) => {
    if (isDirty && !confirm('You have unsaved changes. Leave anyway?')) {
      cancel();
    }
  });

  // Warn before closing the tab
  $effect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });

  // Timezone picker
  let tzSearch = $state('');
  let tzPickerOpen = $state(false);
  let tzInputEl: HTMLInputElement | undefined = $state();

  interface TzOption {
    id: string;
    label: string;
    offset: string;
    offsetMins: number;
    region: string;
  }

  function getAllTimezones(): TzOption[] {
    const zones: TzOption[] = [];
    const now = new Date();
    // Use Intl to get all supported timezones
    const allZones = Intl.supportedValuesOf('timeZone');

    for (const tz of allZones) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'shortOffset',
        });
        const parts = formatter.formatToParts(now);
        const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';

        // Get numeric offset
        const d = new Date(now.toLocaleString('en-US', { timeZone: tz }));
        const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        const offsetMins = (d.getTime() - utc.getTime()) / 60000;

        const region = tz.split('/')[0];
        const city = tz.split('/').slice(1).join('/').replace(/_/g, ' ');

        zones.push({
          id: tz,
          label: city || tz,
          offset: offsetPart,
          offsetMins,
          region,
        });
      } catch {
        // Skip invalid
      }
    }

    return zones.sort((a, b) => a.offsetMins - b.offsetMins);
  }

  const allTimezones = getAllTimezones();
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let filteredTimezones = $derived(
    tzSearch.trim()
      ? allTimezones
          .filter(
            (tz) =>
              tz.id.toLowerCase().includes(tzSearch.toLowerCase()) ||
              tz.label.toLowerCase().includes(tzSearch.toLowerCase()) ||
              tz.offset.toLowerCase().includes(tzSearch.toLowerCase()),
          )
          .slice(0, 30)
      : allTimezones
          .filter(
            (tz) =>
              // Show browser tz + common ones when no search
              tz.id === browserTz ||
              tz.id === timezone ||
              tz.region === 'America' ||
              tz.region === 'Europe' ||
              tz.region === 'Asia' ||
              tz.region === 'Australia' ||
              tz.region === 'Pacific',
          )
          .slice(0, 30),
  );

  let currentTzDisplay = $derived(() => {
    const tz = allTimezones.find((t) => t.id === timezone);
    return tz ? `${tz.label} (${tz.offset})` : timezone;
  });

  function selectTimezone(tz: TzOption) {
    timezone = tz.id;
    tzPickerOpen = false;
    tzSearch = '';
  }

  async function loadSettings() {
    try {
      // Use cached data as optimistic initial value while fetching fresh data
      const cached = getCachedSettings();
      if (cached) {
        config = cached;
      }
      // Always fetch fresh data from the server
      config = await settings.get();
      setCachedSettings(config);
      timezone = origTimezone = config.settings.timezone;
      workStart = origWorkStart = config.settings.workingHours.start;
      workEnd = origWorkEnd = config.settings.workingHours.end;
      personalStart = origPersonalStart = config.settings.personalHours.start;
      personalEnd = origPersonalEnd = config.settings.personalHours.end;
      freeSlotOnComplete = origFreeSlotOnComplete = config.settings.freeSlotOnComplete ?? false;
      schedulingWindowDays = origSchedulingWindowDays =
        config.settings.schedulingWindowDays ?? DEFAULT_SCHEDULING_WINDOW_DAYS;
      trimCompletedEvents = origTrimCompletedEvents = config.settings.trimCompletedEvents ?? true;
      breakBetweenItemsMinutes = origBreakBetweenItemsMinutes =
        config.settings.breakBetweenItemsMinutes ?? DEFAULT_BREAK_BETWEEN_MINUTES;
      autoCompleteHabits = origAutoCompleteHabits = config.settings.autoCompleteHabits ?? true;
    } catch {
      // silent
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saving) return;
    saving = true;
    try {
      const updated = await settings.update({
        timezone,
        workingHours: { start: workStart, end: workEnd },
        personalHours: { start: personalStart, end: personalEnd },
        freeSlotOnComplete,
        schedulingWindowDays,
        trimCompletedEvents,
        breakBetweenItemsMinutes,
        autoCompleteHabits,
      });
      setCachedSettings(updated);
      origFreeSlotOnComplete = freeSlotOnComplete;
      origTimezone = timezone;
      origWorkStart = workStart;
      origWorkEnd = workEnd;
      origPersonalStart = personalStart;
      origPersonalEnd = personalEnd;
      origSchedulingWindowDays = schedulingWindowDays;
      origTrimCompletedEvents = trimCompletedEvents;
      origBreakBetweenItemsMinutes = breakBetweenItemsMinutes;
      origAutoCompleteHabits = autoCompleteHabits;
      showToast('Settings saved', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to save settings', 'error');
      }
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    loadSettings();
  });
</script>

<svelte:window
  onclick={() => {
    if (tzPickerOpen) tzPickerOpen = false;
  }}
/>

<section class="settings-section">
  <h3>General</h3>

  {#if loading}
    <p class="text-secondary">Loading...</p>
  {:else}
    <!-- Timezone picker -->
    <div class="form-field" data-setting-id="timezone">
      <label class="form-label" for="settings-tz">Timezone</label>
      <div class="tz-picker" role="presentation" onclick={(e) => e.stopPropagation()}>
        <button
          class="tz-trigger"
          onclick={() => {
            tzPickerOpen = !tzPickerOpen;
            if (tzPickerOpen) {
              requestAnimationFrame(() => tzInputEl?.focus());
            }
          }}
          type="button"
        >
          <Globe size={14} />
          <span class="tz-current">{currentTzDisplay()}</span>
        </button>

        {#if tzPickerOpen}
          <div class="tz-dropdown">
            <div class="tz-search">
              <Search size={14} />
              <input
                bind:this={tzInputEl}
                bind:value={tzSearch}
                type="text"
                placeholder="Search timezones..."
                class="tz-search-input"
                onkeydown={(e) => {
                  if (e.key === 'Escape') {
                    tzPickerOpen = false;
                    tzSearch = '';
                  }
                }}
              />
            </div>
            <div class="tz-list">
              {#each filteredTimezones as tz (tz.id)}
                <button
                  class="tz-option"
                  class:tz-option-active={tz.id === timezone}
                  onclick={() => selectTimezone(tz)}
                >
                  <span class="tz-option-name">{tz.label}</span>
                  <span class="tz-option-offset">{tz.offset}</span>
                </button>
              {/each}
              {#if filteredTimezones.length === 0}
                <div class="tz-empty">No timezones found</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div data-setting-id="working-hours">
      <h4>Working hours</h4>
      <TimeRangeSlider bind:start={workStart} bind:end={workEnd} color="accent" />
    </div>

    <div data-setting-id="personal-hours">
      <h4>Personal hours</h4>
      <TimeRangeSlider bind:start={personalStart} bind:end={personalEnd} color="success" />
    </div>

    <h4>Scheduling</h4>

    <div data-setting-id="scheduling-window">
      <div class="slider-header">
        <span class="slider-label">Scheduling window</span>
        <span class="slider-value"
          >{schedulingWindowDays} {schedulingWindowDays === 1 ? 'day' : 'days'}</span
        >
      </div>
      <input
        type="range"
        class="settings-range"
        min={1}
        max={planLimits.schedulingWindowDays}
        step={1}
        bind:value={schedulingWindowDays}
        aria-label="Scheduling window"
      />
      {#if userPlan === 'free'}
        <span class="plan-hint">Pro: up to 90 days</span>
      {/if}
    </div>

    <div class="toggle-row" data-setting-id="trim-completed">
      <div class="toggle-info">
        <span class="toggle-label">Trim completed events</span>
        <span class="toggle-desc">Shrink events to actual duration when marked complete early.</span
        >
      </div>
      <button
        class="toggle-switch"
        class:toggle-on={trimCompletedEvents}
        onclick={() => (trimCompletedEvents = !trimCompletedEvents)}
        role="switch"
        aria-checked={trimCompletedEvents}
        aria-label="Trim completed events"
      ></button>
    </div>

    <div class="toggle-row" data-setting-id="free-slot-on-complete">
      <div class="toggle-info">
        <span class="toggle-label">Free slot on complete</span>
        <span class="toggle-desc"
          >When you mark an event as done, allow the scheduler to use that time for other items.</span
        >
      </div>
      <button
        class="toggle-switch"
        class:toggle-on={freeSlotOnComplete}
        onclick={() => (freeSlotOnComplete = !freeSlotOnComplete)}
        role="switch"
        aria-checked={freeSlotOnComplete}
        aria-label="Free slot on complete"
      ></button>
    </div>

    <div class="toggle-row" data-setting-id="auto-complete-habits">
      <div class="toggle-info">
        <span class="toggle-label">Auto-complete habits</span>
        <span class="toggle-desc"
          >Automatically mark habits as completed when their scheduled time ends.</span
        >
      </div>
      <button
        class="toggle-switch"
        class:toggle-on={autoCompleteHabits}
        onclick={() => (autoCompleteHabits = !autoCompleteHabits)}
        role="switch"
        aria-checked={autoCompleteHabits}
        aria-label="Auto-complete habits"
      ></button>
    </div>

    <h4>Buffers</h4>

    <div data-setting-id="buffer-break">
      <DurationSlider
        bind:value={breakBetweenItemsMinutes}
        min={0}
        max={180}
        step={5}
        label="Break between items"
      />
      <span class="field-desc">Minimum gap the scheduler adds between back-to-back items.</span>
    </div>

    <div class="save-row">
      {#if isDirty}
        <span class="unsaved-hint">Unsaved changes</span>
      {/if}
      <button class="btn-primary" onclick={handleSave} disabled={saving || !isDirty}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-section {
    @include flex-col(var(--space-4));
  }

  .text-secondary {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  h4 {
    font-size: 0.9375rem;
    margin-top: var(--space-2);
    color: var(--color-text-secondary);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .toggle-info {
    @include flex-col(var(--space-1));
  }

  .toggle-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .toggle-desc {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    line-height: 1.4;
  }

  .save-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    justify-content: flex-end;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-separator);
  }

  .unsaved-hint {
    font-size: 0.6875rem;
    color: var(--color-warning-amber);
    font-weight: 500;
  }

  // ---- Timezone picker ----
  .tz-picker {
    position: relative;
  }

  .tz-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 6px var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: $font-body;
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
    transition: border-color var(--transition-fast);

    &:hover {
      border-color: var(--color-border-strong);
    }

    :global(svg) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .tz-current {
    flex: 1;
    @include text-truncate;
  }

  .tz-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: var(--space-1);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: $z-dropdown;
    overflow: hidden;
  }

  .tz-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-separator);

    :global(svg) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .tz-search-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: $font-body;
    font-size: 0.8125rem;
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

  .tz-list {
    max-height: 240px;
    overflow-y: auto;
    padding: var(--space-1) 0;
  }

  .tz-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px var(--space-3);
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: $font-body;
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  .tz-option-active {
    color: var(--color-accent);
    font-weight: 500;
  }

  .tz-option-name {
    @include text-truncate;
    min-width: 0;
  }

  .tz-option-offset {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    flex-shrink: 0;
    margin-left: var(--space-2);
    font-variant-numeric: tabular-nums;
  }

  .tz-empty {
    padding: var(--space-6) var(--space-3);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .slider-label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .slider-value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .settings-range {
    width: 100%;
    height: 4px;
    appearance: none;
    background: var(--color-surface-hover);
    border-radius: 2px;
    outline: none;
    cursor: pointer;

    &::-webkit-slider-thumb {
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--color-accent);
      border: 2px solid var(--color-surface);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
      cursor: pointer;
    }

    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--color-accent);
      border: 2px solid var(--color-surface);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
      cursor: pointer;
    }
  }

  .plan-hint {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    font-style: italic;
  }

  .field-desc {
    display: block;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    line-height: 1.4;
    margin-top: var(--space-1);
  }
</style>
