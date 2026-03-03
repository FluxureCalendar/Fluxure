<script lang="ts">
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import { CalendarMode } from '@fluxure/shared';
  import type { Calendar } from '@fluxure/shared';

  interface Props {
    calendarList: Calendar[];
    discoveringCalendars: boolean;
    writableCalendars: Calendar[];
    defaultHabitCalendarId: string;
    defaultTaskCalendarId: string;
    ondiscover: () => void;
    ontoggle: (cal: Calendar) => void;
    onsetmode: (cal: Calendar, mode: CalendarMode) => void;
    wouldRemoveLastWritable: (cal: Calendar) => boolean;
  }

  let {
    calendarList,
    discoveringCalendars,
    writableCalendars,
    defaultHabitCalendarId = $bindable(),
    defaultTaskCalendarId = $bindable(),
    ondiscover,
    ontoggle,
    onsetmode,
    wouldRemoveLastWritable,
  }: Props = $props();
</script>

<section aria-labelledby="calendars-heading" class="settings-section">
  <div class="section-row">
    <h2 id="calendars-heading" class="section-heading section-heading--inline">Calendars</h2>
    <button class="btn-action" onclick={ondiscover} disabled={discoveringCalendars}>
      <RefreshCw size={14} class={discoveringCalendars ? 'spinning' : ''} />
      {discoveringCalendars ? 'Refreshing...' : 'Refresh'}
    </button>
  </div>

  {#if calendarList.length === 0}
    <p class="text-hint">No calendars found. Click Refresh to discover your calendars.</p>
  {:else}
    <!-- Calendar table -->
    <div class="cal-table">
      {#each calendarList as cal, i (cal.id)}
        <div class="cal-row" class:cal-row--bordered={i > 0}>
          <div class="cal-info">
            <span class="cal-dot" style:background={cal.color ?? 'var(--color-accent)'}></span>
            <span class="cal-name">{cal.name}</span>
            {#if cal.isPrimary}
              <span class="cal-primary-badge">Primary</span>
            {/if}
          </div>
          <div class="cal-actions">
            {#if cal.isPrimary}
              <span class="cal-always-on">Always on</span>
            {:else}
              {#if cal.enabled}
                <select
                  value={cal.mode}
                  onchange={(e) => onsetmode(cal, e.currentTarget.value as CalendarMode)}
                  aria-label={`Mode for ${cal.name}`}
                  class="cal-mode-select"
                >
                  <option value="writable">Writable</option>
                  <option value="locked">Locked</option>
                </select>
              {/if}
              <button
                onclick={() => ontoggle(cal)}
                role="switch"
                aria-checked={cal.enabled}
                aria-label="Toggle {cal.name}"
                class="toggle-switch"
                class:toggle-switch--on={cal.enabled}
                disabled={wouldRemoveLastWritable(cal)}
                title={wouldRemoveLastWritable(cal)
                  ? 'At least one writable calendar is required'
                  : ''}
              >
                <span class="toggle-switch-knob" class:toggle-switch-knob--on={cal.enabled}></span>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Default Calendars -->
    <div class="default-cals">
      <h3 class="subsection-heading">Default Calendars</h3>
      <div class="form-row">
        <div class="form-field">
          <label for="default-habit-cal">Habits</label>
          {#if writableCalendars.length === 0}
            <select id="default-habit-cal" disabled>
              <option value="">-- no writable calendars --</option>
            </select>
            <span class="text-hint">Enable a writable calendar above to select a default.</span>
          {:else}
            <select id="default-habit-cal" bind:value={defaultHabitCalendarId}>
              {#each writableCalendars as cal (cal.id)}
                <option value={cal.id}>{cal.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <div class="form-field">
          <label for="default-task-cal">Tasks</label>
          {#if writableCalendars.length === 0}
            <select id="default-task-cal" disabled>
              <option value="">-- no writable calendars --</option>
            </select>
            <span class="text-hint">Enable a writable calendar above to select a default.</span>
          {:else}
            <select id="default-task-cal" bind:value={defaultTaskCalendarId}>
              {#each writableCalendars as cal (cal.id)}
                <option value={cal.id}>{cal.name}</option>
              {/each}
            </select>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</section>

<hr class="section-divider" />

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .section-row {
    @include flex-between;
  }

  .subsection-heading {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-3) 0;
  }

  .default-cals {
    margin-top: var(--space-5);
  }
</style>
