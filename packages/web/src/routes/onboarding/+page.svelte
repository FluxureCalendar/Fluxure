<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  import { SvelteMap } from 'svelte/reactivity';
  import { onMount, tick } from 'svelte';
  import { groupTimezones } from '$lib/utils/timezone';
  import { getAuthState, googleAuth, isValidGoogleOAuthUrl, checkAuth } from '$lib/auth.svelte';
  import {
    settings as settingsApi,
    habits as habitsApi,
    calendars as calendarsApi,
  } from '$lib/api';
  import { Frequency, CalendarMode } from '@fluxure/shared';
  import type { Calendar } from '@fluxure/shared';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import CalendarIcon from 'lucide-svelte/icons/calendar';
  import Check from 'lucide-svelte/icons/check';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import Lock from 'lucide-svelte/icons/lock';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Dumbbell from 'lucide-svelte/icons/dumbbell';
  import BookOpen from 'lucide-svelte/icons/book-open';
  import Brain from 'lucide-svelte/icons/brain';
  import ClipboardList from 'lucide-svelte/icons/clipboard-list';
  import Languages from 'lucide-svelte/icons/languages';

  const TOTAL_STEPS = 6;

  // Initialize at step 0; URL ?step= param is applied after auth verification in onMount
  let currentStep = $state(0);
  let stepKey = $state(0);
  let stepDirection = $state<'forward' | 'back'>('forward');
  let wizardBodyEl = $state<HTMLElement | undefined>(undefined);

  $effect(() => {
    // Track stepKey to trigger focus when step changes
    void stepKey;
    tick().then(() => {
      const heading = wizardBodyEl?.querySelector<HTMLElement>('h1, h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
  });

  // Step 1: Calendar connection
  let calendarConnected = $state(false);

  // Step 2: Calendar selection
  let calendarList = $state<Calendar[]>([]);
  let discoveringCalendars = $state(false);
  let calendarsLoaded = $state(false);

  async function discoverCalendars() {
    discoveringCalendars = true;
    try {
      calendarList = await calendarsApi.discover();
      calendarsLoaded = true;
    } catch {
      // ignore
    } finally {
      discoveringCalendars = false;
    }
  }

  async function loadCalendars() {
    try {
      calendarList = await calendarsApi.list();
      calendarsLoaded = calendarList.length > 0;
      if (!calendarsLoaded) {
        await discoverCalendars();
      }
    } catch {
      await discoverCalendars();
    }
  }

  /** At least one writable calendar must remain enabled */
  function wouldRemoveLastWritable(cal: Calendar): boolean {
    const writableCount = calendarList.filter(
      (c: Calendar) => c.enabled && c.mode === 'writable' && c.id !== cal.id,
    ).length;
    // If this calendar is currently enabled+writable and it's the only one, block
    return cal.enabled && cal.mode === 'writable' && writableCount === 0;
  }

  // Track calendar changes locally (no API calls during onboarding)
  let calendarChanges = new SvelteMap<string, { enabled?: boolean; mode?: CalendarMode }>();

  function toggleCalendar(cal: Calendar) {
    const existing = calendarChanges.get(cal.id) ?? {};
    const newEnabled = !(existing.enabled ?? cal.enabled);
    calendarChanges.set(cal.id, { ...existing, enabled: newEnabled });

    // Update local display state instantly
    calendarList = calendarList.map((c: Calendar) =>
      c.id === cal.id ? { ...c, enabled: newEnabled } : c,
    );
  }

  function setCalendarMode(cal: Calendar, mode: CalendarMode) {
    const existing = calendarChanges.get(cal.id) ?? {};
    calendarChanges.set(cal.id, { ...existing, mode });

    calendarList = calendarList.map((c: Calendar) => (c.id === cal.id ? { ...c, mode } : c));
  }

  onMount(async () => {
    // Auth guard: redirect to login if not authenticated
    const auth = getAuthState();
    if (!auth.isAuthenticated && !auth.isLoading) {
      goto(resolve('/login'));
      return;
    }
    if (auth.isLoading) {
      const { checkAuth } = await import('$lib/auth.svelte');
      const user = await checkAuth();
      if (!user) {
        goto(resolve('/login'));
        return;
      }
    }

    // Apply URL step parameter only after auth verification
    const resumeStep = page.url.searchParams.get('step');
    if (resumeStep) {
      const parsed = Math.max(0, Math.min(parseInt(resumeStep, 10) || 0, TOTAL_STEPS - 1));
      currentStep = parsed;
    }

    try {
      const status = await settingsApi.getGoogleStatus();
      calendarConnected = status.connected;
      // Skip welcome + connect steps if already connected via Google sign-in
      if (calendarConnected && currentStep < 2) {
        currentStep = 2;
        stepKey += 1;
      }
      // Auto-discover calendars when landing on or skipping to the calendar step
      if (calendarConnected && currentStep === 2 && !calendarsLoaded) {
        loadCalendars();
      }
    } catch {
      // ignore
    }
  });

  // Step 3: Working hours
  let workStart = $state('09:00');
  let workEnd = $state('17:00');
  let timezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Step 4: First habit
  let habitName = $state('');
  let habitDuration = $state(30);
  let habitFrequency = $state('daily');
  let selectedSuggestion = $state('');
  let gdprConsent: boolean = $state(false);

  const suggestions = [
    { name: 'Morning workout', icon: Dumbbell, duration: 45, frequency: 'daily' },
    { name: 'Read', icon: BookOpen, duration: 30, frequency: 'daily' },
    { name: 'Meditate', icon: Brain, duration: 15, frequency: 'daily' },
    { name: 'Plan my day', icon: ClipboardList, duration: 15, frequency: 'weekdays' },
    { name: 'Learn a language', icon: Languages, duration: 30, frequency: '3x_week' },
  ];

  const timezoneGroups = groupTimezones();

  let canProceed = $derived(
    currentStep === 0
      ? true
      : currentStep === 1
        ? true // calendar is optional
        : currentStep === 2
          ? true // calendar selection is optional
          : currentStep === 3
            ? workStart < workEnd // String comparison works for HH:MM format (e.g., "09:00" < "17:00")
            : currentStep === 4
              ? habitName.trim().length > 0
              : currentStep === 5
                ? gdprConsent
                : true,
  );

  let stepCtaLabel = $derived(
    currentStep === 0
      ? "Let's go"
      : currentStep === 1
        ? calendarConnected
          ? 'Continue'
          : 'Skip for now'
        : currentStep === 2
          ? 'Continue'
          : currentStep === 3
            ? 'Continue'
            : currentStep === 4
              ? 'Create habit'
              : 'Continue',
  );

  function selectSuggestion(s: (typeof suggestions)[number]) {
    selectedSuggestion = s.name;
    habitName = s.name;
    habitDuration = s.duration;
    habitFrequency = s.frequency;
  }

  function nextStep() {
    // Load calendars when entering the calendar selection step
    if (currentStep === 1 && calendarConnected && !calendarsLoaded) {
      loadCalendars();
    }

    if (currentStep < TOTAL_STEPS - 1) {
      stepDirection = 'forward';
      currentStep += 1;
      stepKey += 1;
    }
  }

  function prevStep() {
    const minStep = calendarConnected ? 2 : 0;
    if (currentStep > minStep) {
      stepDirection = 'back';
      currentStep -= 1;
      stepKey += 1;
    }
  }

  let saving = $state(false);
  let showToast = $state(false);
  let toastMsg = $state('');

  async function completeOnboarding() {
    saving = true;
    try {
      // Batch-save all onboarding data at once
      const saves: Promise<unknown>[] = [];

      // 1. Save calendar enable/mode changes
      for (const [calId, changes] of calendarChanges) {
        saves.push(
          calendarsApi.update(calId, changes).catch(() => {
            showToast = true;
            toastMsg = 'Some settings could not be saved';
          }),
        );
      }

      // 2. Save working hours + timezone
      saves.push(
        settingsApi
          .update({
            workingHours: { start: workStart, end: workEnd },
            timezone,
          })
          .catch(() => {
            showToast = true;
            toastMsg = 'Some settings could not be saved';
          }),
      );

      // 3. Create first habit (if specified)
      if (habitName.trim()) {
        const daysMap: Record<string, string[]> = {
          daily: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
          weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
          '3x_week': ['mon', 'wed', 'fri'],
        };
        saves.push(
          habitsApi
            .create({
              name: habitName.trim(),
              durationMin: habitDuration,
              durationMax: habitDuration,
              frequency: Frequency.Daily,
              frequencyConfig: { days: daysMap[habitFrequency] ?? daysMap.weekdays },
              priority: 2,
              windowStart: '06:00',
              windowEnd: '12:00',
              idealTime: '08:00',
            })
            .catch(() => {
              showToast = true;
              toastMsg = 'Some settings could not be saved';
            }),
        );
      }

      // Fire all saves in parallel, then mark onboarding complete
      await Promise.all(saves);
      await settingsApi.completeOnboarding();
      // Refresh JWT so onboardingCompleted flag is updated
      await checkAuth();
    } catch {
      // Continue to dashboard even if API calls fail
    } finally {
      saving = false;
    }
  }

  async function skipOnboarding() {
    await completeOnboarding();
    goto(resolve('/'));
  }

  async function goToDashboard() {
    await completeOnboarding();
    goto(resolve('/'));
  }

  async function connectGoogle() {
    // Check if already connected via the existing Google OAuth flow
    try {
      const response = await settingsApi.connectGoogle();
      if (response.redirectUrl && isValidGoogleOAuthUrl(response.redirectUrl)) {
        window.location.href = response.redirectUrl;
      } else if (response.redirectUrl) {
        throw new Error('Invalid OAuth redirect URL');
      }
    } catch {
      // fallback
      return googleAuth();
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Get started')}</title>
</svelte:head>

<div class="wizard">
  <div class="wizard-header">
    <span class="sidebar-logo">F</span>
    <div class="wizard-progress" role="group" aria-label="Onboarding progress">
      <span class="sr-only">Step {currentStep + 1} of {TOTAL_STEPS}</span>
      {#each Array(TOTAL_STEPS) as _, i (i)}
        <div
          class="wizard-dot"
          class:active={i === currentStep}
          class:completed={i < currentStep}
          aria-hidden="true"
        ></div>
        {#if i < TOTAL_STEPS - 1}
          <div class="wizard-track" class:filled={i < currentStep} aria-hidden="true"></div>
        {/if}
      {/each}
    </div>
    <button class="wizard-skip" onclick={skipOnboarding} disabled={saving}> Skip </button>
  </div>

  <div class="wizard-body" bind:this={wizardBodyEl}>
    {#key stepKey}
      <div class="wizard-step" class:wizard-step--back={stepDirection === 'back'}>
        {#if currentStep === 0}
          <!-- Step 1: Welcome -->
          <div class="wizard-welcome">
            <div class="wizard-welcome-icon">
              <CalendarIcon size={32} />
            </div>
            <h1>Welcome to Fluxure</h1>
            <p>
              Fluxure automatically places your habits, tasks, and focus time on your calendar -- so
              you can stop planning and start doing.
            </p>
            <p class="wizard-welcome-time">This takes about 2 minutes.</p>
          </div>
        {:else if currentStep === 1}
          <!-- Step 2: Connect Calendar -->
          <div class="wizard-calendar">
            <h2>Connect your calendar</h2>
            <p>
              Fluxure needs access to your Google Calendar to read events and schedule new ones.
            </p>

            {#if !calendarConnected}
              <button
                class="auth-btn-social wizard-google-btn"
                onclick={connectGoogle}
                type="button"
              >
                <GoogleLogo />
                Connect Google Calendar
              </button>
              <p class="wizard-privacy-note">
                <Lock size={14} />
                We only read and create events. We never share your data.
              </p>
            {:else}
              <div class="wizard-success-card">
                <Check size={20} />
                <span>Google Calendar connected</span>
              </div>
            {/if}
          </div>
        {:else if currentStep === 2}
          <!-- Step 3: Choose Calendars -->
          <div class="wizard-calendars">
            <h2>Choose your calendars</h2>
            <p>Select which calendars Fluxure can see and schedule on.</p>

            {#if !calendarConnected}
              <p class="text-hint">Connect Google Calendar first to manage your calendars.</p>
            {:else if discoveringCalendars}
              <div class="wizard-calendars-loading">
                <RefreshCw size={18} class="spinning" />
                <span>Discovering your calendars...</span>
              </div>
            {:else if calendarList.length === 0}
              <p class="text-hint">No calendars found.</p>
              <button class="wizard-btn-refresh" onclick={discoverCalendars} type="button">
                <RefreshCw size={14} />
                Discover calendars
              </button>
            {:else}
              <div class="wizard-cal-table">
                {#each calendarList as cal, i (cal.id)}
                  <div class="cal-row" class:cal-row--bordered={i > 0}>
                    <div class="cal-info">
                      <span class="cal-dot" style:background={cal.color ?? 'var(--color-accent)'}
                      ></span>
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
                            onchange={(e) =>
                              setCalendarMode(cal, e.currentTarget.value as CalendarMode)}
                            aria-label={`Mode for ${cal.name}`}
                            class="cal-mode-select"
                          >
                            <option value="writable">Writable</option>
                            <option value="locked">Locked</option>
                          </select>
                        {/if}
                        <button
                          onclick={() => toggleCalendar(cal)}
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
                          <span
                            class="toggle-switch-knob"
                            class:toggle-switch-knob--on={cal.enabled}
                          ></span>
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
              <p class="wizard-cal-hint">
                <strong>Writable</strong> = Fluxure can create events. <strong>Locked</strong> = read-only,
                used to avoid conflicts.
              </p>
            {/if}
          </div>
        {:else if currentStep === 3}
          <!-- Step 4: Working Hours -->
          <div class="wizard-hours">
            <h2>Set your working hours</h2>
            <p>Tell us when you're available so we schedule around your real life.</p>

            <div class="wizard-hours-grid">
              <div class="form-field">
                <label for="wiz-work-start">Work starts</label>
                <input id="wiz-work-start" type="time" bind:value={workStart} class="font-mono" />
              </div>
              <div class="form-field">
                <label for="wiz-work-end">Work ends</label>
                <input id="wiz-work-end" type="time" bind:value={workEnd} class="font-mono" />
              </div>
            </div>

            <div class="form-field" style="margin-top: var(--space-4);">
              <label for="wiz-timezone">Timezone</label>
              <select id="wiz-timezone" bind:value={timezone}>
                {#each timezoneGroups as group (group.label)}
                  <optgroup label={group.label}>
                    {#each group.zones as tz (tz)}
                      <option value={tz}>{tz.replace(/_/g, ' ')}</option>
                    {/each}
                  </optgroup>
                {/each}
              </select>
            </div>
          </div>
        {:else if currentStep === 4}
          <!-- Step 5: First Habit -->
          <div class="wizard-habit">
            <h2>Create your first habit</h2>
            <p>Pick something you want to do regularly. Fluxure will find time for it.</p>

            <div class="wizard-habit-suggestions">
              {#each suggestions as s (s.name)}
                <button
                  class="wizard-habit-chip"
                  class:selected={selectedSuggestion === s.name}
                  onclick={() => selectSuggestion(s)}
                  type="button"
                >
                  <s.icon size={16} />
                  {s.name}
                </button>
              {/each}
            </div>

            <div class="auth-form">
              <div class="auth-field">
                <label for="wiz-habit-name">Habit name</label>
                <div class="auth-input-wrap">
                  <input
                    id="wiz-habit-name"
                    type="text"
                    bind:value={habitName}
                    placeholder="e.g., Morning workout"
                  />
                </div>
              </div>

              <div class="form-row">
                <div class="form-field">
                  <label for="wiz-habit-duration">Duration</label>
                  <select id="wiz-habit-duration" bind:value={habitDuration}>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>
                <div class="form-field">
                  <label for="wiz-habit-frequency">Frequency</label>
                  <select id="wiz-habit-frequency" bind:value={habitFrequency}>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="3x_week">3x / week</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <!-- Step 6: All Set -->
          <div class="wizard-complete">
            <div class="wizard-complete-icon">
              <Check size={32} />
            </div>
            <h1>You're all set!</h1>
            <p>
              Fluxure is now managing your calendar. Your first habit will appear on your schedule
              shortly.
            </p>
            <div class="wizard-consent">
              <input type="checkbox" id="gdpr-consent" bind:checked={gdprConsent} />
              <label for="gdpr-consent"
                >I agree to the <a
                  href={resolve('/privacy')}
                  target="_blank"
                  rel="noopener noreferrer">Privacy Policy</a
                > and consent to Fluxure processing my calendar data as described.</label
              >
            </div>
          </div>
        {/if}
      </div>
    {/key}
  </div>

  <div class="wizard-footer">
    {#if currentStep > (calendarConnected ? 2 : 0) && currentStep < TOTAL_STEPS - 1}
      <button class="wizard-btn-back" onclick={prevStep} type="button">
        <ChevronLeft size={16} />
        Back
      </button>
    {:else}
      <div></div>
    {/if}

    {#if currentStep < TOTAL_STEPS - 1}
      <button class="wizard-btn-next" onclick={nextStep} disabled={!canProceed} type="button">
        {stepCtaLabel}
        <ChevronRight size={16} />
      </button>
    {:else}
      <button class="wizard-btn-next" onclick={goToDashboard} disabled={saving} type="button">
        {saving ? 'Saving...' : 'Open Fluxure'}
        {#if !saving}<ArrowRight size={16} />{/if}
      </button>
    {/if}
  </div>
</div>

{#if showToast}
  <div class="onboarding-toast" role="alert">
    {toastMsg}
    <button
      class="onboarding-toast-close"
      onclick={() => {
        showToast = false;
      }}
      aria-label="Dismiss">&times;</button
    >
  </div>
{/if}
