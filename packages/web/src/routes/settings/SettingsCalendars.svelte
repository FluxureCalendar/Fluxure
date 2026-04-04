<script module lang="ts">
  let _statusCache: { connected: boolean; at: number } | null = null;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { calendars, settings, schedule } from '$lib/api';
  import { setSyncing } from '$lib/sync-state.svelte';
  import type { Calendar } from '@fluxure/shared';
  import { CalendarMode } from '@fluxure/shared';
  import { loadCalendars, getCalendars, setCalendars } from '$lib/calendars.svelte';
  import { googleAuth } from '$lib/auth.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { getCachedSettings, setCachedSettings } from '$lib/cache.svelte';

  import CheckCircle2 from 'lucide-svelte/icons/check-circle-2';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Unplug from 'lucide-svelte/icons/unplug';

  let calendarList = $derived(getCalendars());
  let loading = $state(true);
  let googleConnected = $state(false);
  let discovering = $state(false);
  let syncing = $state(false);
  let confirmDisconnect = $state(false);
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  let defaultHabitCalendarId = $state<string | null>(null);
  let defaultTaskCalendarId = $state<string | null>(null);
  let origDefaultHabitCalendarId: string | null = null;
  let origDefaultTaskCalendarId: string | null = null;
  let savingDefaults = $state(false);

  let calendarsDirty = $derived(
    defaultHabitCalendarId !== origDefaultHabitCalendarId ||
      defaultTaskCalendarId !== origDefaultTaskCalendarId,
  );

  let writableCalendars = $derived(
    (calendarList ?? []).filter((c: any) => c.enabled && (c.mode === 'writable' || c.isPrimary)),
  );

  const STATUS_TTL = 5 * 60_000; // 5 minutes

  async function load() {
    try {
      await loadCalendars(true);
      if (_statusCache && Date.now() - _statusCache.at < STATUS_TTL) {
        googleConnected = _statusCache.connected;
      } else {
        const status = await settings.getGoogleStatus();
        googleConnected = status.connected;
        _statusCache = { connected: status.connected, at: Date.now() };
      }
      // Load default calendar preferences
      const cached = getCachedSettings();
      const config = cached ?? (await settings.get());
      if (!cached) setCachedSettings(config);
      defaultHabitCalendarId = origDefaultHabitCalendarId =
        config.settings.defaultHabitCalendarId ?? null;
      defaultTaskCalendarId = origDefaultTaskCalendarId =
        config.settings.defaultTaskCalendarId ?? null;
    } catch {
      // silent
    } finally {
      loading = false;
    }
  }

  async function connectGoogle() {
    _statusCache = null;
    try {
      await googleAuth();
    } catch (err) {
      if (err instanceof Error) {
        showToast(err.message, 'error');
      }
    }
  }

  function handleDisconnectClick() {
    if (!confirmDisconnect) {
      confirmDisconnect = true;
      disconnectTimer = setTimeout(() => {
        confirmDisconnect = false;
      }, 4000);
      return;
    }
    executeDisconnect();
  }

  async function executeDisconnect() {
    try {
      await settings.disconnectGoogle();
      googleConnected = false;
      setCalendars([]);
      _statusCache = null;
      showToast('Google disconnected', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to disconnect', 'error');
      }
    } finally {
      confirmDisconnect = false;
      if (disconnectTimer) clearTimeout(disconnectTimer);
    }
  }

  function toggleCalendar(cal: Calendar) {
    if (cal.isPrimary) return;
    const newEnabled = !cal.enabled;
    setCalendars(calendarList.map((c) => (c.id === cal.id ? { ...c, enabled: newEnabled } : c)));
    calendars.update(cal.id, { enabled: newEnabled }).catch(() => {
      setCalendars(calendarList.map((c) => (c.id === cal.id ? { ...c, enabled: !newEnabled } : c)));
      showToast('Failed to update calendar', 'error');
    });
  }

  function setCalendarMode(cal: Calendar, mode: CalendarMode) {
    const prev = cal.mode;
    setCalendars(calendarList.map((c) => (c.id === cal.id ? { ...c, mode } : c)));
    calendars.update(cal.id, { mode }).catch(() => {
      setCalendars(calendarList.map((c) => (c.id === cal.id ? { ...c, mode: prev } : c)));
      showToast('Failed to update calendar mode', 'error');
    });
  }

  async function forceSync() {
    if (syncing) return;
    syncing = true;
    setSyncing(true);
    showToast('Syncing calendars...', 'info');
    try {
      await schedule.forceSync();
      await loadCalendars(true);
      showToast('Calendars synced', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to sync', 'error');
      }
    } finally {
      syncing = false;
      setSyncing(false);
    }
  }

  async function discoverCalendars() {
    if (discovering) return;
    discovering = true;
    try {
      const discovered = await calendars.discover();
      setCalendars(discovered);
      showToast(`Found ${discovered.length} calendars`, 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to discover calendars', 'error');
      }
    } finally {
      discovering = false;
    }
  }

  async function saveDefaults() {
    if (savingDefaults) return;
    savingDefaults = true;
    try {
      const updated = await settings.update({
        defaultHabitCalendarId,
        defaultTaskCalendarId,
      });
      setCachedSettings(updated);
      origDefaultHabitCalendarId = defaultHabitCalendarId;
      origDefaultTaskCalendarId = defaultTaskCalendarId;
      showToast('Default calendars saved', 'success');
    } catch {
      showToast('Failed to save defaults', 'error');
    } finally {
      savingDefaults = false;
    }
  }

  onMount(() => {
    load();
    return () => {
      if (disconnectTimer) clearTimeout(disconnectTimer);
    };
  });
</script>

<section class="settings-section">
  <h3>Calendars</h3>

  {#if loading}
    <p class="text-secondary">Loading...</p>
  {:else}
    <div
      class="google-card"
      class:google-connected={googleConnected}
      data-setting-id="google-calendar"
    >
      {#if googleConnected}
        <div class="google-status-row">
          <div class="google-connected-badge">
            <CheckCircle2 size={16} />
            <span>Google Calendar connected</span>
          </div>
        </div>
        <div class="google-actions">
          <button class="btn-secondary" onclick={forceSync} disabled={syncing}>
            <RefreshCw size={14} class={syncing ? 'loading-spinner' : ''} />
            {syncing ? 'Syncing...' : 'Force sync'}
          </button>
          <button class="btn-secondary" onclick={discoverCalendars} disabled={discovering}>
            <RefreshCw size={14} class={discovering ? 'loading-spinner' : ''} />
            {discovering ? 'Discovering...' : 'Discover calendars'}
          </button>
          <button
            class="btn-danger"
            class:btn-confirming={confirmDisconnect}
            onclick={handleDisconnectClick}
          >
            <Unplug size={14} />
            {confirmDisconnect ? 'Are you sure?' : 'Disconnect'}
          </button>
        </div>
      {:else}
        <p class="google-desc">
          Connect your Google Calendar to sync events and enable scheduling.
        </p>
        <button class="btn-primary" onclick={connectGoogle}>Connect Google Calendar</button>
      {/if}
    </div>

    {#if googleConnected && writableCalendars.length > 0}
      <div class="defaults-section">
        <h4>Default calendars</h4>

        <div class="form-field" data-setting-id="default-habit-calendar">
          <label class="form-label" for="default-habit-cal">Default habit calendar</label>
          <select id="default-habit-cal" class="form-select" bind:value={defaultHabitCalendarId}>
            <option value={null}>Primary (default)</option>
            {#each writableCalendars as cal (cal.id)}
              <option value={cal.id}>{cal.name}</option>
            {/each}
          </select>
          <span class="field-desc">Calendar used for new habits when none is specified.</span>
        </div>

        <div class="form-field" data-setting-id="default-task-calendar">
          <label class="form-label" for="default-task-cal">Default task calendar</label>
          <select id="default-task-cal" class="form-select" bind:value={defaultTaskCalendarId}>
            <option value={null}>Primary (default)</option>
            {#each writableCalendars as cal (cal.id)}
              <option value={cal.id}>{cal.name}</option>
            {/each}
          </select>
          <span class="field-desc">Calendar used for new tasks when none is specified.</span>
        </div>

        {#if calendarsDirty}
          <div class="save-row">
            <span class="unsaved-hint">Unsaved changes</span>
            <button class="btn-primary" onclick={saveDefaults} disabled={savingDefaults}>
              {savingDefaults ? 'Saving...' : 'Save'}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if calendarList.length > 0}
      <div class="calendar-list">
        {#each calendarList as cal (cal.id)}
          <div class="calendar-row" class:calendar-disabled={!cal.enabled}>
            <div class="calendar-left">
              <span class="calendar-color" style:background-color={cal.color}></span>
              <div class="calendar-text">
                <span class="calendar-name">{cal.name}</span>
                {#if cal.isPrimary}
                  <span class="calendar-sub">Primary · Always on</span>
                {:else if cal.enabled}
                  <span class="calendar-sub"
                    >{cal.mode === CalendarMode.Writable ? 'Writable' : 'Read-only'}</span
                  >
                {/if}
              </div>
            </div>
            <div class="calendar-controls">
              {#if cal.enabled && !cal.isPrimary}
                <select
                  class="mode-select"
                  value={cal.mode}
                  onchange={(e) =>
                    setCalendarMode(cal, (e.target as HTMLSelectElement).value as CalendarMode)}
                  aria-label="Mode for {cal.name}"
                >
                  <option value={CalendarMode.Writable}>Writable</option>
                  <option value={CalendarMode.Locked}>Read-only</option>
                </select>
              {/if}
              {#if !cal.isPrimary}
                <button
                  class="toggle-switch"
                  class:toggle-on={cal.enabled}
                  onclick={() => toggleCalendar(cal)}
                  role="switch"
                  aria-checked={cal.enabled}
                  aria-label="Toggle {cal.name}"
                ></button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-section {
    @include flex-col(var(--space-4));
  }

  .google-card {
    @include flex-col(var(--space-3));
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }

  .google-connected {
    border-color: var(--color-success);
    background: var(--color-success-muted);
  }

  .google-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .google-connected-badge {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-success);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .google-desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .google-actions {
    display: flex;
    gap: var(--space-2);
  }

  .text-secondary {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .calendar-list {
    @include flex-col;
  }

  .calendar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    transition: opacity var(--transition-fast);

    & + & {
      border-top: 1px solid var(--color-separator);
    }

    &.calendar-disabled {
      opacity: 0.4;
    }
  }

  .calendar-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    flex: 1;
  }

  .calendar-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .calendar-color {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .calendar-name {
    font-size: 0.875rem;
    @include text-truncate;
  }

  .calendar-sub {
    font-size: 0.625rem;
    color: var(--color-text-tertiary);
  }

  .calendar-controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .mode-select {
    appearance: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236B8898' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e");
    background-repeat: no-repeat;
    background-position: right 4px center;
    background-size: 10px 8px;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: 0.6875rem;
    padding: 2px var(--space-4) 2px var(--space-2);
    height: 24px;
    cursor: pointer;
    outline: none;
    transition: border-color var(--transition-fast);

    &:focus {
      border-color: var(--color-accent);
    }
  }

  .btn-confirming {
    background: var(--color-danger-muted);
    border-color: var(--color-danger);
  }

  .defaults-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-separator);
    margin-bottom: var(--space-4);
  }

  .defaults-section h4 {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
    margin: 0;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .form-select {
    width: 100%;
    padding: 6px var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: $font-body;
    font-size: 0.875rem;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 28px;

    &:hover {
      border-color: var(--color-border-strong);
    }

    &:focus {
      outline: 2px solid var(--color-accent);
      outline-offset: -1px;
    }
  }

  .field-desc {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    line-height: 1.4;
  }

  .save-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    justify-content: flex-end;
  }

  .unsaved-hint {
    font-size: 0.6875rem;
    color: var(--color-warning-amber);
    font-weight: 500;
  }
</style>
