<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { showSuccess, showError, showInfo } from '$lib/notifications.svelte';
  import { onMount, onDestroy, untrack } from 'svelte';
  import Check from 'lucide-svelte/icons/check';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import Download from 'lucide-svelte/icons/download';
  import {
    settings as settingsApi,
    buffers as buffersApi,
    calendars as calendarsApi,
    schedule as scheduleApi,
    auth as authApi,
    schedulingTemplates as templatesApi,
  } from '$lib/api';
  import type { SessionInfo } from '$lib/api';
  import {
    getCachedSettings,
    setCachedSettings,
    invalidateSettings,
    invalidateTemplates,
  } from '$lib/cache.svelte';
  import { loadCalendars, getCalendars, setCalendars } from '$lib/calendars.svelte';
  import { createSchedulingTemplateState } from '$lib/scheduling-templates.svelte';
  import type { Calendar } from '@fluxure/shared';
  import {
    CalendarMode,
    DecompressionTarget,
    DEFAULT_SCHEDULING_WINDOW_DAYS,
    DEFAULT_PAST_EVENT_RETENTION_DAYS,
    DEFAULT_TRAVEL_TIME_MINUTES,
    DEFAULT_DECOMPRESSION_MINUTES,
    DEFAULT_BREAK_BETWEEN_MINUTES,
    SCHEDULING_WINDOW_MIN_DAYS,
    SCHEDULING_WINDOW_MAX_DAYS,
    PAST_EVENT_RETENTION_MIN_DAYS,
    PAST_EVENT_RETENTION_MAX_DAYS,
  } from '@fluxure/shared';
  import { isValidGoogleOAuthUrl } from '$lib/auth.svelte';
  import SettingsAccount from './SettingsAccount.svelte';
  import SettingsBilling from './SettingsBilling.svelte';
  import SettingsCalendars from './SettingsCalendars.svelte';
  import SettingsTemplates from './SettingsTemplates.svelte';
  import SettingsGeneral from './SettingsGeneral.svelte';

  let googleConnected = $state(false);
  let loading = $state(true);

  let workStart = $state('09:00');
  let workEnd = $state('17:00');

  let personalStart = $state('17:00');
  let personalEnd = $state('22:00');

  let timezone = $state('America/New_York');
  let schedulingWindowDays = $state(DEFAULT_SCHEDULING_WINDOW_DAYS);
  let pastEventRetentionDays = $state(DEFAULT_PAST_EVENT_RETENTION_DAYS);
  let trimCompletedEvents = $state(true);

  let travelTime = $state(DEFAULT_TRAVEL_TIME_MINUTES);
  let decompressionTime = $state(DEFAULT_DECOMPRESSION_MINUTES);
  let breakBetween = $state(DEFAULT_BREAK_BETWEEN_MINUTES);
  let decompApplyTo = $state<DecompressionTarget>(DecompressionTarget.All);

  let calendarList = $derived(getCalendars());
  let discoveringCalendars = $state(false);
  let defaultHabitCalendarId = $state('primary');
  let defaultTaskCalendarId = $state('primary');

  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined;

  // Prevents saving default values when API failed to load
  let loadFailed = $state(false);

  let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
  let pwaInstalled = $state(false);

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let userName = $state('');
  let userEmail = $state('');
  let userAvatarUrl = $state<string | null>(null);
  let userHasPassword = $state(false);

  let exporting = $state(false);
  let exportingCalendar = $state(false);

  let sessionList = $state<SessionInfo[]>([]);
  let revokingAll = $state(false);

  const templateState = createSchedulingTemplateState();
  let templates = $derived(templateState.state.templates);

  // Pre-populate from cache to avoid flash of default values
  function applyCachedValues() {
    const cachedConfig = getCachedSettings();
    if (cachedConfig?.settings) {
      workStart = cachedConfig.settings.workingHours?.start ?? workStart;
      workEnd = cachedConfig.settings.workingHours?.end ?? workEnd;
      personalStart = cachedConfig.settings.personalHours?.start ?? personalStart;
      personalEnd = cachedConfig.settings.personalHours?.end ?? personalEnd;
      timezone = cachedConfig.settings.timezone ?? timezone;
      schedulingWindowDays = cachedConfig.settings.schedulingWindowDays ?? schedulingWindowDays;
      pastEventRetentionDays =
        cachedConfig.settings.pastEventRetentionDays ?? pastEventRetentionDays;
      trimCompletedEvents = cachedConfig.settings.trimCompletedEvents !== false;
      defaultHabitCalendarId =
        cachedConfig.settings.defaultHabitCalendarId ?? defaultHabitCalendarId;
      defaultTaskCalendarId = cachedConfig.settings.defaultTaskCalendarId ?? defaultTaskCalendarId;
    }
  }
  applyCachedValues();

  let hoursError = $derived.by(() => {
    const errors: string[] = [];
    if (workEnd <= workStart) errors.push('Work end time must be after start time.');
    if (personalEnd <= personalStart) errors.push('Personal end time must be after start time.');
    return errors.join(' ');
  });
  let hoursValid = $derived(hoursError === '');

  // Primary calendar is always writable (Google owner access)
  let writableCalendars = $derived(
    calendarList.filter((c: Calendar) => c.enabled && (c.mode === 'writable' || c.isPrimary)),
  );

  async function saveSettings() {
    if (
      schedulingWindowDays < SCHEDULING_WINDOW_MIN_DAYS ||
      schedulingWindowDays > SCHEDULING_WINDOW_MAX_DAYS
    ) {
      showError('Scheduling window must be between 1 and 90 days.');
      return;
    }
    if (
      pastEventRetentionDays < PAST_EVENT_RETENTION_MIN_DAYS ||
      pastEventRetentionDays > PAST_EVENT_RETENTION_MAX_DAYS
    ) {
      showError('Past event retention must be between 1 and 30 days.');
      return;
    }

    if (!hoursValid) {
      showError(hoursError);
      return;
    }

    saveStatus = 'saving';
    try {
      await settingsApi.update({
        workingHours: { start: workStart, end: workEnd },
        personalHours: { start: personalStart, end: personalEnd },
        timezone,
        schedulingWindowDays,
        pastEventRetentionDays,
        trimCompletedEvents,
        defaultHabitCalendarId,
        defaultTaskCalendarId,
      });
      await buffersApi.update({
        travelTimeMinutes: travelTime,
        decompressionMinutes: decompressionTime,
        breakBetweenItemsMinutes: breakBetween,
        applyDecompressionTo: decompApplyTo,
      });
      saveStatus = 'saved';
      // Refresh global cache so other pages get fresh settings
      invalidateSettings();
      settingsApi
        .get()
        .then((config) => setCachedSettings(config))
        .catch(() => {});
      showSuccess('Settings saved successfully.');
    } catch {
      saveStatus = 'error';
      showError('Failed to save settings.');
    }
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => {
      saveStatus = 'idle';
    }, 2000);
  }

  async function discoverCalendars() {
    discoveringCalendars = true;

    try {
      const discovered = await calendarsApi.discover();
      setCalendars(discovered);
      showSuccess('Calendars refreshed from Google.');
    } catch {
      showError('Failed to discover calendars.');
    } finally {
      discoveringCalendars = false;
    }
  }

  /** At least one writable calendar must remain enabled */
  function wouldRemoveLastWritable(cal: Calendar): boolean {
    const writableCount = calendarList.filter(
      (c: Calendar) => c.enabled && c.mode === 'writable' && c.id !== cal.id,
    ).length;
    return cal.enabled && cal.mode === 'writable' && writableCount === 0;
  }

  async function toggleCalendar(cal: Calendar) {
    if (wouldRemoveLastWritable(cal)) {
      showError('At least one writable calendar must remain enabled.');
      return;
    }
    try {
      const updated = await calendarsApi.update(cal.id, { enabled: !cal.enabled });
      setCalendars(calendarList.map((c: Calendar) => (c.id === cal.id ? updated : c)));
    } catch {
      showError('Failed to update calendar.');
    }
  }

  async function setCalendarMode(cal: Calendar, mode: CalendarMode) {
    try {
      const updated = await calendarsApi.update(cal.id, { mode });
      setCalendars(calendarList.map((c: Calendar) => (c.id === cal.id ? updated : c)));
    } catch {
      showError('Failed to update calendar mode.');
    }
  }

  async function handleGoogleToggle() {
    if (googleConnected) {
      try {
        await settingsApi.disconnectGoogle();
        googleConnected = false;
        showSuccess('Google Calendar disconnected.');
      } catch {
        showError('Failed to disconnect.');
      }
    } else {
      try {
        const res = await settingsApi.connectGoogle();
        if (res.redirectUrl && isValidGoogleOAuthUrl(res.redirectUrl)) {
          window.location.href = res.redirectUrl;
        } else if (res.redirectUrl) {
          showError('Unexpected OAuth redirect URL');
        }
      } catch {
        showError('Failed to start Google connection.');
      }
    }
  }

  async function handleInstallApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      pwaInstalled = true;
      installPrompt = null;
    }
  }

  let initials = $derived(
    userName
      ? userName
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : userEmail
        ? userEmail[0].toUpperCase()
        : '?',
  );

  async function handleExportData(categories: string[]) {
    exporting = true;

    try {
      await authApi.requestExport(categories);
      showSuccess('Export queued — check your email.');
    } catch {
      showError('Failed to request data export.');
    } finally {
      exporting = false;
    }
  }

  async function handleExportCalendar() {
    exportingCalendar = true;
    try {
      await scheduleApi.export();
      showSuccess('Calendar downloaded.');
    } catch {
      showError('Failed to download calendar.');
    } finally {
      exportingCalendar = false;
    }
  }

  async function loadSessions() {
    try {
      const result = await authApi.getSessions();
      sessionList = result.sessions;
    } catch {
      // Non-critical — sessions list is supplementary
    }
  }

  async function handleRevokeSession(id: string) {
    try {
      await authApi.revokeSession(id);
      sessionList = sessionList.filter((s) => s.id !== id);
      showSuccess('Session revoked.');
    } catch {
      showError('Failed to revoke session.');
    }
  }

  async function handleRevokeOtherSessions() {
    revokingAll = true;

    try {
      await authApi.revokeOtherSessions();
      sessionList = sessionList.filter((s) => s.current);
      showSuccess('All other sessions revoked.');
    } catch {
      showError('Failed to revoke sessions.');
    } finally {
      revokingAll = false;
    }
  }

  async function handleDeleteAccount(email: string, password: string) {
    try {
      await authApi.deleteAccount(password || undefined, email || undefined);
      goto('/login', { state: { deleted: true } });
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : 'Failed to delete account.');
    }
  }

  async function handleNukeEvents() {
    try {
      const result = await scheduleApi.deleteAllManaged();
      showSuccess(
        `Deleted ${result.googleEventsDeleted} events from Google Calendar and ${result.localEventsDeleted} from local database.`,
      );
    } catch {
      showError('Failed to delete managed events.');
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await templatesApi.delete(id);
      invalidateTemplates();
      await templateState.load();
      showSuccess('Template deleted.');
    } catch {
      showError('Failed to delete template.');
    }
  }

  function handleInstallPrompt(e: Event) {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
  }

  function handleInstalled() {
    pwaInstalled = true;
    installPrompt = null;
  }

  onDestroy(() => {
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
    window.removeEventListener('appinstalled', handleInstalled);
  });

  onMount(async () => {
    // Handle billing redirect from Stripe
    const billingResult = untrack(() => page.url.searchParams.get('billing'));
    if (billingResult === 'success') {
      showSuccess('Upgrade successful! Your Pro plan is now active.');
      const url = new URL(page.url);
      url.searchParams.delete('billing');
      history.replaceState({}, '', url.pathname);
    } else if (billingResult === 'cancel') {
      showInfo('Checkout cancelled.');
      const url = new URL(page.url);
      url.searchParams.delete('billing');
      history.replaceState({}, '', url.pathname);
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      pwaInstalled = true;
    }

    loading = true;

    try {
      const [config, bufferConfig, , authStatus, meResult] = await Promise.all([
        settingsApi.get(),
        buffersApi.get(),
        loadCalendars(true),
        settingsApi.getGoogleStatus(),
        authApi.me(),
      ]);

      if (meResult.user) {
        userName = meResult.user.name || '';
        userEmail = meResult.user.email || '';
        userAvatarUrl = meResult.user.avatarUrl?.startsWith('https://')
          ? meResult.user.avatarUrl
          : null;
        userHasPassword = !!meResult.user.hasPassword;
      }

      // Load sessions and templates in background (non-blocking)
      loadSessions();
      templateState.load();

      setCachedSettings(config);
      googleConnected = authStatus.connected;

      if (config.settings) {
        workStart = config.settings.workingHours?.start ?? '09:00';
        workEnd = config.settings.workingHours?.end ?? '17:00';
        personalStart = config.settings.personalHours?.start ?? '17:00';
        personalEnd = config.settings.personalHours?.end ?? '22:00';
        timezone = config.settings.timezone ?? 'America/New_York';
        schedulingWindowDays =
          config.settings.schedulingWindowDays ?? DEFAULT_SCHEDULING_WINDOW_DAYS;
        pastEventRetentionDays =
          config.settings.pastEventRetentionDays ?? DEFAULT_PAST_EVENT_RETENTION_DAYS;
        trimCompletedEvents = config.settings.trimCompletedEvents !== false;
        defaultHabitCalendarId = config.settings.defaultHabitCalendarId ?? 'primary';
        defaultTaskCalendarId = config.settings.defaultTaskCalendarId ?? 'primary';
      }

      travelTime = bufferConfig.travelTimeMinutes ?? 15;
      decompressionTime = bufferConfig.decompressionMinutes ?? 5;
      breakBetween = bufferConfig.breakBetweenItemsMinutes ?? 10;
      decompApplyTo = bufferConfig.applyDecompressionTo ?? DecompressionTarget.All;
    } catch {
      loadFailed = true;
      showError('Failed to load settings. Displaying defaults — saving is disabled.');
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Settings')}</title>
</svelte:head>

<main class="settings-page">
  <h1 class="settings-title" id="settings-heading">Settings</h1>

  {#if loading}
    <div class="settings-loading" role="status" aria-live="polite">
      <p>Loading...</p>
    </div>
  {:else}
    <div class="settings-sections">
      <!-- Google Account -->
      <section aria-labelledby="google-heading" class="settings-section">
        <h2 id="google-heading" class="section-heading">Google Account</h2>
        <div class="section-row">
          <div class="status-indicator">
            <span
              aria-hidden="true"
              class="status-dot"
              class:status-dot--connected={googleConnected}
            ></span>
            <span class="status-label">
              {googleConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button class="btn-cancel" onclick={handleGoogleToggle}>
            {googleConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </section>

      <hr class="section-divider" />

      <!-- Calendars -->
      {#if googleConnected}
        <SettingsCalendars
          {calendarList}
          {discoveringCalendars}
          {writableCalendars}
          bind:defaultHabitCalendarId
          bind:defaultTaskCalendarId
          ondiscover={discoverCalendars}
          ontoggle={toggleCalendar}
          onsetmode={setCalendarMode}
          {wouldRemoveLastWritable}
        />
      {/if}

      <!-- Working Hours -->
      <section aria-labelledby="work-hours-heading" class="settings-section">
        <h2 id="work-hours-heading" class="section-heading">Working Hours</h2>
        <div class="form-row">
          <div class="form-field">
            <label for="work-start">Start</label>
            <input id="work-start" type="time" bind:value={workStart} class="font-mono" />
          </div>
          <div class="form-field">
            <label for="work-end">End</label>
            <input
              id="work-end"
              type="time"
              bind:value={workEnd}
              class="font-mono"
              aria-invalid={workEnd <= workStart ? true : undefined}
            />
          </div>
        </div>
        {#if workEnd <= workStart}
          <p class="validation-error">End time must be after start time.</p>
        {/if}
      </section>

      <hr class="section-divider" />

      <!-- Personal Hours -->
      <section aria-labelledby="personal-hours-heading" class="settings-section">
        <h2 id="personal-hours-heading" class="section-heading">Personal Hours</h2>
        <div class="form-row">
          <div class="form-field">
            <label for="personal-start">Start</label>
            <input id="personal-start" type="time" bind:value={personalStart} class="font-mono" />
          </div>
          <div class="form-field">
            <label for="personal-end">End</label>
            <input
              id="personal-end"
              type="time"
              bind:value={personalEnd}
              class="font-mono"
              aria-invalid={personalEnd <= personalStart ? true : undefined}
            />
          </div>
        </div>
        {#if personalEnd <= personalStart}
          <p class="validation-error">End time must be after start time.</p>
        {/if}
      </section>

      <hr class="section-divider" />

      <!-- Scheduling Templates -->
      <SettingsTemplates
        {templates}
        onaddtemplate={async (name, startTime, endTime) => {
          await templatesApi.create({ name, startTime, endTime });
          invalidateTemplates();
          await templateState.load();
          showSuccess('Template added.');
        }}
        ondeletetemplate={deleteTemplate}
      />

      <hr class="section-divider" />

      <!-- General + Buffers -->
      <SettingsGeneral
        bind:timezone
        bind:schedulingWindowDays
        bind:pastEventRetentionDays
        bind:trimCompletedEvents
        bind:travelTime
        bind:decompressionTime
        bind:breakBetween
        bind:decompApplyTo
      />

      <!-- Install App -->
      {#if installPrompt || pwaInstalled}
        <hr class="section-divider" />

        <section aria-labelledby="install-heading" class="settings-section">
          <h2 id="install-heading" class="section-heading">Install App</h2>
          {#if pwaInstalled}
            <p class="text-hint">Fluxure is installed on this device.</p>
          {:else}
            <p class="text-hint install-desc">
              Install Fluxure as a standalone app for quick access.
            </p>
            <button class="btn-install" onclick={handleInstallApp}>
              <Download size={14} />
              Install Fluxure
            </button>
          {/if}
        </section>
      {/if}

      <SettingsBilling />

      <hr class="section-divider" />

      <SettingsAccount
        {userName}
        {userEmail}
        bind:userAvatarUrl
        {userHasPassword}
        {initials}
        {sessionList}
        {googleConnected}
        onexportdata={handleExportData}
        onexportcalendar={handleExportCalendar}
        onrevokesession={handleRevokeSession}
        onrevokeothersessions={handleRevokeOtherSessions}
        ondeleteaccount={handleDeleteAccount}
        onnukeevents={handleNukeEvents}
        oncanceldanger={() => {}}
        {exporting}
        {exportingCalendar}
        {revokingAll}
      />
    </div>

    {#if hoursError}
      <p class="validation-error" id="hours-error">{hoursError}</p>
    {/if}

    <!-- Sticky Save Button -->
    <div class="save-bar">
      <button
        class="btn-save-full"
        onclick={saveSettings}
        disabled={saveStatus === 'saving' || !hoursValid || loadFailed}
        title={!hoursValid ? hoursError : ''}
        aria-describedby={!hoursValid ? 'hours-error' : undefined}
        class:btn-save-full--saved={saveStatus === 'saved'}
      >
        <span class="save-inner">
          {#if saveStatus === 'saving'}
            <Loader2 size={16} class="spinning" />
            Saving...
          {:else if saveStatus === 'saved'}
            <Check size={16} />
            Saved
          {:else if saveStatus === 'error'}
            Failed -- Retry
          {:else}
            Save Settings
          {/if}
        </span>
      </button>
    </div>
  {/if}
</main>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  /* Page layout */
  .settings-page {
    padding: var(--space-6);
    max-width: 720px;
  }

  .settings-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-6) 0;
  }

  .settings-loading {
    @include flex-center;
    padding: var(--space-12) 0;

    p {
      color: var(--color-text-secondary);
      font-size: 0.875rem;
    }
  }

  .settings-sections {
    @include flex-col;
  }

  /* Status indicator (Google connection) */
  .status-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-danger);

    &--connected {
      background: var(--color-success);
    }
  }

  .status-label {
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .validation-error {
    font-size: 0.8125rem;
    color: var(--color-danger);
    margin: var(--space-2) 0 0 0;
  }

  /* Install app */
  .install-desc {
    margin-bottom: var(--space-3);
  }

  .btn-install {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-accent);
    background: transparent;
    color: var(--color-accent);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);

    &:hover {
      background: var(--color-accent);
      color: var(--color-accent-text);
    }
  }

  /* Sticky save bar */
  .save-bar {
    position: sticky;
    bottom: 0;
    padding: var(--space-4) 0;
    background: var(--color-bg);
    border-top: 1px solid var(--color-border);
    margin-top: var(--space-2);
  }

  .btn-save-full {
    width: 100%;
    padding: var(--space-2) 0;
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    background: var(--color-accent);
    color: var(--color-accent-text);
    transition:
      background var(--transition-fast),
      opacity var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &--saved {
      background: var(--color-success);
    }
  }

  .save-inner {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .section-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
</style>
