<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { onMount } from 'svelte';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import Check from 'lucide-svelte/icons/check';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import { focusTime as focusApi } from '$lib/api';
  import { SchedulingHours } from '@fluxure/shared';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';

  let weeklyTarget = $state(10);
  let dailyTarget = $state(2);
  let schedulingHours = $state('working');
  const templateState = createSchedulingTemplateState();
  let schedulingTemplates = $derived(templateState.state.templates);
  let enabled = $state(true);
  let loading = $state(true);
  let loadFailed = $state(false);
  let error = $state('');
  let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');

  // No API endpoint provides daily breakdown yet
  let dailyBreakdown = $state<{ day: string; hours: number }[]>([]);

  let weeklyActual = $derived(dailyBreakdown.reduce((sum, d) => sum + d.hours, 0));

  let progressPercent = $derived(
    weeklyTarget <= 0 ? 0 : Math.min(100, Math.round((weeklyActual / weeklyTarget) * 100)),
  );

  const ringRadius = 58;
  const ringCircumference = 2 * Math.PI * ringRadius;
  let ringDashoffset = $derived(ringCircumference * (1 - progressPercent / 100));

  let maxBarHours = $derived(Math.max(...dailyBreakdown.map((d) => d.hours), dailyTarget, 0.1));

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
    };
  });

  async function saveConfig() {
    saveStatus = 'saving';
    error = '';
    try {
      await focusApi.update({
        weeklyTargetMinutes: weeklyTarget * 60,
        dailyTargetMinutes: dailyTarget * 60,
        schedulingHours: schedulingHours as SchedulingHours,
        enabled,
      });
      saveStatus = 'saved';
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveStatus = 'idle';
      }, 2000);
    } catch (err) {
      if (err instanceof TypeError) {
        error = "You're offline — check your connection";
      } else {
        error = err instanceof Error ? err.message : 'Failed to save configuration.';
      }
      saveStatus = 'idle';
    }
  }

  async function loadConfig() {
    loading = true;
    error = '';
    loadFailed = false;
    try {
      const config = await focusApi.get();
      weeklyTarget = (config.weeklyTargetMinutes ?? 600) / 60;
      dailyTarget = (config.dailyTargetMinutes ?? 120) / 60;
      schedulingHours = config.schedulingHours ?? 'working';
      enabled = config.enabled ?? true;
    } catch (err) {
      if (err instanceof TypeError) {
        error = "You're offline — check your connection";
      } else {
        error = 'Failed to load data from API.';
      }
      loadFailed = true;
    } finally {
      loading = false;
    }
  }

  function handleScheduleDropdownChange(value: string) {
    templateState.handleDropdownChange(value, (hours) => {
      schedulingHours = hours;
    });
  }

  onMount(() => {
    loadConfig();
    templateState.load();
  });
</script>

<svelte:head>
  <title>{pageTitle('Focus Time')}</title>
</svelte:head>

<div class="page-wrapper">
  <h1 class="page-title">Focus Time</h1>

  {#if error}
    <div class="alert-error" role="alert">
      {error}
      {#if loadFailed}
        <button
          class="retry-btn"
          onclick={() => {
            loadConfig();
          }}
        >
          <RefreshCw size={14} strokeWidth={1.5} />
          Retry
        </button>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading-container" role="status" aria-live="polite">
      <p>Loading...</p>
    </div>
  {:else}
    <div class="focus-layout">
      <!-- Configuration -->
      <div class="config-column">
        <div class="card">
          <h2 class="card-heading">Configuration</h2>

          <div class="config-fields">
            <!-- Enable toggle -->
            <div class="toggle-row">
              <span id="focus-enable-label" class="toggle-row-label">Enable Focus Time</span>
              <button
                id="focus-enable-toggle"
                onclick={() => {
                  enabled = !enabled;
                }}
                role="switch"
                aria-checked={enabled}
                aria-labelledby="focus-enable-label"
                class="toggle-switch"
                class:toggle-switch--on={enabled}
              >
                <span class="toggle-switch-knob" class:toggle-switch-knob--on={enabled}></span>
              </button>
            </div>

            <!-- Weekly Target -->
            <div class="form-field">
              <label for="focus-weekly-target">Weekly Target</label>
              <div class="input-with-unit">
                <input
                  id="focus-weekly-target"
                  type="number"
                  bind:value={weeklyTarget}
                  min="0"
                  max="60"
                  step="0.5"
                  class="font-mono"
                />
                <span class="input-unit">hours</span>
              </div>
            </div>

            <!-- Daily Target -->
            <div class="form-field">
              <label for="focus-daily-target">Daily Target</label>
              <div class="input-with-unit">
                <input
                  id="focus-daily-target"
                  type="number"
                  bind:value={dailyTarget}
                  min="0"
                  max="12"
                  step="0.5"
                  class="font-mono"
                />
                <span class="input-unit">hours</span>
              </div>
            </div>

            <!-- Scheduling Hours -->
            <div class="form-field">
              <label for="focus-sched-hours">Scheduling Hours</label>
              <select
                id="focus-sched-hours"
                value={templateState.getDropdownValue(schedulingHours)}
                onchange={(e) => handleScheduleDropdownChange(e.currentTarget.value)}
              >
                <option value="working">Working Hours</option>
                <option value="personal">Personal Hours</option>
                <option value="custom">Custom</option>
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
          </div>
        </div>

        <!-- Save Button -->
        {#if loadFailed}
          <p id="save-disabled-reason" class="sr-only">
            Save is disabled because configuration failed to load.
          </p>
        {/if}
        <button
          onclick={saveConfig}
          disabled={saveStatus === 'saving' || loadFailed}
          class="btn-save save-btn"
          class:save-btn--saved={saveStatus === 'saved'}
          aria-describedby={loadFailed ? 'save-disabled-reason' : undefined}
        >
          <span class="save-btn-inner">
            {#if saveStatus === 'saving'}
              <Loader2 size={16} class="spin-icon" />
              Saving...
            {:else if saveStatus === 'saved'}
              <Check size={16} />
              Saved
            {:else}
              Save Configuration
            {/if}
          </span>
        </button>
      </div>

      <!-- Progress -->
      <div class="progress-column">
        <!-- Progress Ring -->
        <div class="card ring-card">
          <h2 class="card-heading">This Week</h2>
          <svg
            width="148"
            height="148"
            viewBox="0 0 148 148"
            role="img"
            aria-label="Weekly focus progress: {progressPercent}%"
          >
            <circle
              cx="74"
              cy="74"
              r={ringRadius}
              fill="none"
              stroke="var(--color-border)"
              stroke-width="8"
            />
            <circle
              cx="74"
              cy="74"
              r={ringRadius}
              fill="none"
              stroke="var(--color-accent)"
              stroke-width="8"
              stroke-linecap="round"
              stroke-dasharray={ringCircumference}
              stroke-dashoffset={ringDashoffset}
              transform="rotate(-90 74 74)"
              class="ring-progress"
            />
            <text x="74" y="70" text-anchor="middle" class="ring-pct" aria-hidden="true">
              {progressPercent}%
            </text>
            <text x="74" y="90" text-anchor="middle" class="ring-detail" aria-hidden="true">
              {weeklyActual}h / {weeklyTarget}h
            </text>
          </svg>
        </div>

        <!-- Daily Breakdown -->
        <div class="card">
          <h2 class="card-heading">Daily Breakdown</h2>

          {#if dailyBreakdown.length === 0}
            <p class="breakdown-empty">No breakdown data available yet.</p>
          {:else}
            <div class="breakdown-list">
              {#each dailyBreakdown as day (day.day)}
                {@const barWidth = maxBarHours > 0 ? (day.hours / maxBarHours) * 100 : 0}
                <div class="breakdown-row" aria-label="{day.day}: {day.hours} hours">
                  <span class="font-mono breakdown-day">{day.day}</span>
                  <div class="breakdown-track" aria-hidden="true">
                    {#if day.hours > 0}
                      <div
                        class="breakdown-bar"
                        class:breakdown-bar--met={day.hours >= dailyTarget}
                        style="width: {barWidth}%;"
                      ></div>
                    {/if}
                  </div>
                  <span class="font-mono breakdown-hours">{day.hours}h</span>
                </div>
              {/each}
            </div>

            <div class="legend">
              <span class="legend-item">
                <span class="legend-swatch legend-swatch--met" aria-hidden="true"></span>
                Met target
              </span>
              <span class="legend-item">
                <span class="legend-swatch legend-swatch--below" aria-hidden="true"></span>
                Below target
              </span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .page-wrapper {
    padding: var(--space-6);
    max-width: 960px;
  }

  .page-title {
    margin-bottom: var(--space-6);
  }

  .focus-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-6);
  }

  .config-column,
  .progress-column {
    @include flex-col(var(--space-6));
  }

  .card {
    @include card;
    padding: var(--space-6);
  }

  .card-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-5) 0;
  }

  .config-fields {
    @include flex-col(var(--space-4));
  }

  .toggle-row {
    @include flex-between;
  }

  .toggle-row-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  // Input with unit suffix
  .input-with-unit {
    display: flex;
    align-items: center;
    gap: var(--space-2);

    input {
      flex: 1;
    }
  }

  .input-unit {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  // Save button
  .save-btn {
    width: 100%;
    padding: var(--space-3) 0;

    &--saved {
      background: var(--color-success);

      &:hover {
        background: var(--color-success);
      }
    }
  }

  .save-btn-inner {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  :global(.spin-icon) {
    animation: spin 1s linear infinite;
  }

  // Ring card
  .ring-card {
    display: flex;
    flex-direction: column;
    align-items: center;

    .card-heading {
      align-self: flex-start;
    }
  }

  .ring-progress {
    @include ring-progress;
  }

  .ring-pct {
    font-family: $font-mono;
    font-size: 28px;
    font-weight: 700;
    fill: var(--color-text);
  }

  .ring-detail {
    font-family: $font-mono;
    font-size: 12px;
    fill: var(--color-text-secondary);
  }

  .breakdown-empty {
    color: var(--color-text-tertiary);
    font-size: 0.875rem;
    text-align: center;
    padding: var(--space-6) 0;
  }

  .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: var(--space-3);
    padding: var(--space-1) var(--space-2);
    font-size: 0.8125rem;
    font-weight: 500;
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-danger);
    cursor: pointer;
    @include hover-surface;
  }

  // Daily breakdown
  .breakdown-list {
    @include flex-col(var(--space-2));
    margin-top: var(--space-5);
  }

  .breakdown-row {
    display: grid;
    grid-template-columns: 36px 1fr 40px;
    gap: var(--space-3);
    align-items: center;
  }

  .breakdown-day {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    text-align: right;
  }

  .breakdown-track {
    height: 20px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-hover);
  }

  .breakdown-bar {
    height: 100%;
    border-radius: var(--radius-sm);
    background: var(--color-focus-border);
    transition: width var(--transition-base);

    &--met {
      background: var(--color-accent);
    }
  }

  .breakdown-hours {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    text-align: right;
  }

  // Legend
  .legend {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .legend-swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;

    &--met {
      background: var(--color-accent);
    }

    &--below {
      background: var(--color-focus-border);
    }
  }

  @include mobile {
    .focus-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
