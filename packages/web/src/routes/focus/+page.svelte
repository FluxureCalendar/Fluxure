<script lang="ts">
  import { onMount } from 'svelte';
  import { pageTitle } from '$lib/brand';
  import { focusTime } from '$lib/api';
  import type { FocusTimeRule } from '@fluxure/shared';
  import { SchedulingHours } from '@fluxure/shared';
  import { showToast } from '$lib/toast.svelte';
  import { formatDuration } from '$lib/utils/format';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import TimeRangeSlider from '$lib/components/TimeRangeSlider.svelte';

  let rule = $state<FocusTimeRule | null>(null);
  let loading = $state(true);
  let saving = $state(false);

  let enabled = $state(true);
  let weeklyTarget = $state(300);
  let dailyTarget = $state(60);
  let schedulingHours = $state<SchedulingHours>(SchedulingHours.Working);
  let windowStart = $state('09:00');
  let windowEnd = $state('17:00');
  let loadError = $state('');

  const tmpl = createSchedulingTemplateState();

  // Derived display values
  let dailyPercent = $derived(Math.min(100, Math.round((dailyTarget / 480) * 100)));

  async function loadFocus() {
    try {
      loadError = '';
      rule = await focusTime.get();
      enabled = rule.enabled;
      weeklyTarget = rule.weeklyTargetMinutes;
      dailyTarget = rule.dailyTargetMinutes;
      schedulingHours = rule.schedulingHours;
      windowStart = rule.windowStart ?? '09:00';
      windowEnd = rule.windowEnd ?? '17:00';
    } catch (err) {
      console.error('Failed to load focus rule:', err);
      loadError = 'Failed to load focus settings. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function handleSave() {
    if (saving) return;
    saving = true;
    try {
      await focusTime.update({
        enabled,
        weeklyTargetMinutes: weeklyTarget,
        dailyTargetMinutes: dailyTarget,
        schedulingHours,
        windowStart: schedulingHours === SchedulingHours.Custom ? windowStart : null,
        windowEnd: schedulingHours === SchedulingHours.Custom ? windowEnd : null,
      });
      showToast('Focus time updated', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to update focus time', 'error');
      }
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    loadFocus();
    tmpl.load();
  });
</script>

<svelte:head>
  <title>{pageTitle('Focus time')}</title>
</svelte:head>

<PageHeader title="Focus time" subtitle="Block dedicated deep work time on your calendar" />

{#if !loading}
  {#if loadError}
    <div class="load-error">
      <p>{loadError}</p>
      <button onclick={loadFocus}>Retry</button>
    </div>
  {:else}
    <div class="focus-layout content-enter">
      <!-- Main settings card -->
      <div class="focus-card">
        <div class="focus-header">
          <div class="focus-header-text">
            <span class="focus-status" class:focus-active={enabled}>
              {enabled ? 'Active' : 'Paused'}
            </span>
          </div>
          <button
            class="toggle-switch"
            class:toggle-on={enabled}
            onclick={() => (enabled = !enabled)}
            role="switch"
            aria-checked={enabled}
            aria-label="Enable focus time"
          ></button>
        </div>

        {#if enabled}
          <div class="focus-targets">
            <!-- Daily target with visual bar -->
            <div class="target-block">
              <div class="target-top">
                <label class="target-label" for="focus-daily">Daily target</label>
                <span class="target-value">{formatDuration(dailyTarget)}</span>
              </div>
              <div class="target-bar-track">
                <div class="target-bar-fill" style="width: {dailyPercent}%"></div>
              </div>
              <div class="target-meta">
                <span>{dailyPercent}% of workday</span>
                <span>8h max</span>
              </div>
              <input
                id="focus-daily"
                class="target-range"
                type="range"
                min="15"
                max="480"
                step="15"
                bind:value={dailyTarget}
              />
            </div>

            <!-- Weekly target -->
            <div class="target-block">
              <div class="target-top">
                <label class="target-label" for="focus-weekly">Weekly target</label>
                <span class="target-value">{formatDuration(weeklyTarget)}</span>
              </div>
              <input
                id="focus-weekly"
                class="target-range"
                type="range"
                min="60"
                max="2400"
                step="30"
                bind:value={weeklyTarget}
              />
              <div class="target-meta">
                <span>{Math.round(weeklyTarget / 5)}m avg/day</span>
                <span>40h max</span>
              </div>
            </div>

            <!-- Schedule during -->
            <div class="form-field">
              <label class="form-label" for="focus-schedule">Schedule during</label>
              <select
                id="focus-schedule"
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

            {#if schedulingHours === SchedulingHours.Custom}
              <TimeRangeSlider bind:start={windowStart} bind:end={windowEnd} />
            {/if}
          </div>

          <div class="focus-save">
            <button class="btn-primary" onclick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        {/if}
      </div>

      <!-- Side info panel -->
      {#if enabled}
        <aside class="focus-info">
          <h4 class="info-heading">How it works</h4>
          <ul class="info-list">
            <li>Fluxure finds open slots in your calendar and blocks focus time automatically.</li>
            <li>
              Events are protected — meetings and habits won't be scheduled over focus blocks.
            </li>
            <li>Drag or resize focus blocks on the calendar to adjust them manually.</li>
          </ul>
        </aside>
      {/if}
    </div>
  {/if}
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .focus-layout {
    display: grid;
    grid-template-columns: 1fr 240px;
    gap: var(--space-6);
    max-width: 680px;

    @include mobile {
      grid-template-columns: 1fr;
    }
  }

  .focus-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    @include flex-col(var(--space-6));
  }

  .focus-header {
    @include flex-between;
  }

  .focus-status {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .focus-active {
    color: var(--color-success);
  }

  .focus-targets {
    @include flex-col(var(--space-5));
  }

  .target-block {
    @include flex-col(var(--space-2));
  }

  .target-top {
    @include flex-between;
  }

  .target-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .target-value {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .target-bar-track {
    height: 4px;
    background: var(--color-surface-hover);
    border-radius: 2px;
    overflow: hidden;
  }

  .target-bar-fill {
    height: 100%;
    background: var(--color-focus-border);
    border-radius: 2px;
    transition: width var(--transition-base);
  }

  .target-meta {
    @include flex-between;
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .target-range {
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

  .focus-save {
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-separator);
    display: flex;
    justify-content: flex-end;
  }

  // Side info
  .focus-info {
    @include flex-col(var(--space-3));
    align-self: start;
    padding-top: var(--space-1);
  }

  .info-heading {
    @include section-label;
  }

  .info-list {
    list-style: none;
    padding: 0;
    margin: 0;
    @include flex-col(var(--space-3));

    li {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
      line-height: 1.5;
      padding-left: var(--space-3);
      position: relative;

      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 7px;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--color-focus-border);
      }
    }
  }
</style>
