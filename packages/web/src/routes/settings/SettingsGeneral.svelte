<script lang="ts">
  import {
    DecompressionTarget,
    SCHEDULING_WINDOW_MIN_DAYS,
    SCHEDULING_WINDOW_MAX_DAYS,
    PAST_EVENT_RETENTION_MIN_DAYS,
    PAST_EVENT_RETENTION_MAX_DAYS,
  } from '@fluxure/shared';
  import { groupTimezones } from '$lib/utils/timezone';

  interface Props {
    timezone: string;
    schedulingWindowDays: number;
    pastEventRetentionDays: number;
    trimCompletedEvents: boolean;
    travelTime: number;
    decompressionTime: number;
    breakBetween: number;
    decompApplyTo: DecompressionTarget;
  }

  let {
    timezone = $bindable(),
    schedulingWindowDays = $bindable(),
    pastEventRetentionDays = $bindable(),
    trimCompletedEvents = $bindable(),
    travelTime = $bindable(),
    decompressionTime = $bindable(),
    breakBetween = $bindable(),
    decompApplyTo = $bindable(),
  }: Props = $props();

  const timezoneGroups = groupTimezones();
</script>

<!-- General -->
<section aria-labelledby="general-heading" class="settings-section">
  <h2 id="general-heading" class="section-heading">General</h2>
  <div class="form-row">
    <div class="form-field">
      <label for="settings-timezone">Timezone</label>
      <select id="settings-timezone" bind:value={timezone}>
        {#each timezoneGroups as group (group.label)}
          <optgroup label={group.label}>
            {#each group.zones as tz (tz)}
              <option value={tz}>{tz.replace(/_/g, ' ')}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </div>
    <div class="form-field">
      <label for="settings-window">Scheduling Window</label>
      <div class="input-with-suffix">
        <input
          id="settings-window"
          type="number"
          bind:value={schedulingWindowDays}
          min={SCHEDULING_WINDOW_MIN_DAYS}
          max={SCHEDULING_WINDOW_MAX_DAYS}
          class="font-mono"
        />
        <span class="input-suffix">days ahead</span>
      </div>
    </div>
    <div class="form-field">
      <label for="settings-retention">Past Event Retention</label>
      <div class="input-with-suffix">
        <input
          id="settings-retention"
          type="number"
          bind:value={pastEventRetentionDays}
          min={PAST_EVENT_RETENTION_MIN_DAYS}
          max={PAST_EVENT_RETENTION_MAX_DAYS}
          class="font-mono"
        />
        <span class="input-suffix">days back</span>
      </div>
    </div>
  </div>

  <div class="settings-row">
    <div class="settings-row-label">
      <span class="settings-label">Trim completed events</span>
      <span class="settings-desc"
        >When you mark an event as done early, shrink it to free up the remaining time</span
      >
    </div>
    <button
      onclick={() => {
        trimCompletedEvents = !trimCompletedEvents;
      }}
      role="switch"
      aria-checked={trimCompletedEvents}
      aria-label="Trim completed events"
      class="toggle-switch"
      class:toggle-switch--on={trimCompletedEvents}
    >
      <span class="toggle-switch-knob" class:toggle-switch-knob--on={trimCompletedEvents}></span>
    </button>
  </div>
</section>

<hr class="section-divider" />

<!-- Buffers -->
<section aria-labelledby="buffers-heading" class="settings-section">
  <h2 id="buffers-heading" class="section-heading">Buffers</h2>
  <div class="form-grid-3">
    <div class="form-field">
      <label for="buffer-travel">Travel (min)</label>
      <input
        id="buffer-travel"
        type="number"
        bind:value={travelTime}
        min="0"
        max="120"
        class="font-mono"
      />
    </div>
    <div class="form-field">
      <label for="buffer-decomp">Decompression (min)</label>
      <input
        id="buffer-decomp"
        type="number"
        bind:value={decompressionTime}
        min="0"
        max="60"
        class="font-mono"
      />
    </div>
    <div class="form-field">
      <label for="buffer-break">Break (min)</label>
      <input
        id="buffer-break"
        type="number"
        bind:value={breakBetween}
        min="0"
        max="60"
        class="font-mono"
      />
    </div>
  </div>
  <div class="form-field decomp-field">
    <label for="buffer-decomp-apply">Apply Decompression To</label>
    <select id="buffer-decomp-apply" bind:value={decompApplyTo} class="decomp-select">
      <option value={DecompressionTarget.All}>All Meetings</option>
      <option value={DecompressionTarget.VideoOnly}>Video Calls Only</option>
    </select>
  </div>
</section>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) 0;
  }
  .settings-row-label {
    @include flex-col;
    gap: 2px;
  }
  .settings-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text);
  }
  .settings-desc {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .form-grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-4);
  }
  .input-with-suffix {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    input {
      flex: 1;
    }
    .input-suffix {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
    }
  }
  .decomp-field {
    margin-top: var(--space-4);
  }
  .decomp-select {
    width: auto;
  }

  @include mobile {
    .form-grid-3 {
      grid-template-columns: 1fr !important;
    }
  }
</style>
