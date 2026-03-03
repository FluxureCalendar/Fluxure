<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import type { BookingSlot, BookingLinkInfo, BookingConfirmation } from '@fluxure/shared';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Clock from 'lucide-svelte/icons/clock';
  import User from 'lucide-svelte/icons/user';
  import Mail from 'lucide-svelte/icons/mail';
  import FileText from 'lucide-svelte/icons/file-text';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import Loader from 'lucide-svelte/icons/loader';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import { PUBLIC_API_URL } from '$env/static/public';
  import {
    DEFAULT_API_BASE,
    BOOKING_DATE_RANGE_DAYS,
    BOOKING_NAME_MAX_LENGTH,
    BOOKING_EMAIL_MAX_LENGTH,
    BOOKING_NOTES_MAX_LENGTH,
    addDays,
    format,
  } from '@fluxure/shared';

  const API_BASE = PUBLIC_API_URL || DEFAULT_API_BASE;
  const slug = $derived(page.params.slug);

  const MAX_ERROR_LENGTH = 200;
  function capError(msg: string | undefined, fallback: string): string {
    if (!msg) return fallback;
    return msg.length > MAX_ERROR_LENGTH ? msg.slice(0, MAX_ERROR_LENGTH) + '...' : msg;
  }

  // State machine: 'loading' | 'select' | 'form' | 'submitting' | 'confirmed' | 'error'
  let step = $state<'loading' | 'select' | 'form' | 'submitting' | 'confirmed' | 'error'>(
    'loading',
  );
  let linkInfo = $state<BookingLinkInfo | null>(null);
  let loadError = $state('');

  // Selection state
  let selectedDuration = $state<number>(0);
  let selectedDate = $state('');
  let selectedSlot = $state<BookingSlot | null>(null);

  // Availability
  let availableSlots = $state<BookingSlot[]>([]);
  let slotsLoading = $state(false);
  let slotsError = $state('');

  // Form state
  let formName = $state('');
  let formEmail = $state('');
  let formNotes = $state('');
  let formError = $state('');

  // Confirmation
  let confirmation = $state<BookingConfirmation | null>(null);

  // Owner's timezone (from link info, fallback to browser)
  let ownerTimezone = $derived(
    linkInfo?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  // Generate date chips for the next 14 days in the owner's timezone
  let dateChips = $derived.by(() => {
    const chips: Array<{ value: string; label: string; dayName: string }> = [];
    const today = new Date();
    for (let i = 0; i < BOOKING_DATE_RANGE_DAYS; i++) {
      const d = addDays(today, i);
      const value = format(d, 'yyyy-MM-dd');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: ownerTimezone });
      const label = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: ownerTimezone,
      });
      chips.push({ value, label, dayName });
    }
    return chips;
  });

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: ownerTimezone,
    });
  }

  function formatDateLong(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: ownerTimezone,
    });
  }

  async function fetchLinkInfo() {
    try {
      const res = await fetch(`${API_BASE}/book/${slug}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Not found' }));
        loadError = capError(body.error, 'Booking link not found');
        step = 'error';
        return;
      }
      linkInfo = await res.json();
      selectedDuration = linkInfo!.durations[0] || 30;
      step = 'select';
    } catch {
      loadError =
        typeof navigator !== 'undefined' && !navigator.onLine
          ? "You're offline — check your connection"
          : 'Failed to load booking link. Please try again.';
      step = 'error';
    }
  }

  async function fetchSlots() {
    if (!selectedDate || !selectedDuration) return;
    slotsLoading = true;
    slotsError = '';
    availableSlots = [];
    selectedSlot = null;

    try {
      const params = new URLSearchParams({
        date: selectedDate,
        duration: String(selectedDuration),
      });
      const res = await fetch(`${API_BASE}/book/${slug}/availability?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to load slots' }));
        slotsError = capError(body.error, 'Failed to load available times');
        return;
      }
      const data = await res.json();
      availableSlots = data.slots;
    } catch {
      slotsError =
        typeof navigator !== 'undefined' && !navigator.onLine
          ? "You're offline — check your connection"
          : 'Failed to load available times. Please try again.';
    } finally {
      slotsLoading = false;
    }
  }

  function selectDate(date: string) {
    selectedDate = date;
    fetchSlots();
  }

  function selectDuration(dur: number) {
    selectedDuration = dur;
    if (selectedDate) {
      fetchSlots();
    }
  }

  function selectSlot(slot: BookingSlot) {
    selectedSlot = slot;
    step = 'form';
    formError = '';
  }

  function goBackToSelect() {
    step = 'select';
    selectedSlot = null;
    formError = '';
  }

  async function submitBooking() {
    if (!selectedSlot) return;

    // Client-side validation
    if (!formName.trim()) {
      formError = 'Name is required';
      return;
    }
    if (!formEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) {
      formError = 'Valid email is required';
      return;
    }

    step = 'submitting';
    formError = '';

    try {
      const res = await fetch(`${API_BASE}/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: selectedSlot.start,
          end: selectedSlot.end,
          name: formName.trim(),
          email: formEmail.trim(),
          notes: formNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Booking failed' }));
        formError = capError(body.error, 'Booking failed. Please try again.');
        step = 'form';
        return;
      }

      confirmation = await res.json();
      step = 'confirmed';
    } catch {
      formError =
        typeof navigator !== 'undefined' && !navigator.onLine
          ? "You're offline — check your connection"
          : 'Booking failed. Please try again.';
      step = 'form';
    }
  }

  onMount(() => {
    fetchLinkInfo();
  });
</script>

<svelte:head>
  <title>{linkInfo ? `Book — ${linkInfo.name}` : 'Book a time'}</title>
</svelte:head>

<div class="booking-page">
  {#if step === 'loading'}
    <div class="booking-loading">
      <Loader size={24} strokeWidth={1.5} class="spin" />
      <span>Loading...</span>
    </div>
  {:else if step === 'error'}
    <div class="booking-error-card">
      <AlertCircle size={32} strokeWidth={1.5} />
      <h2>Unavailable</h2>
      <p>{loadError}</p>
    </div>
  {:else if step === 'select'}
    <div class="booking-card">
      <h1 class="booking-title">{linkInfo?.name}</h1>
      <p class="booking-subtitle">Select a date and time to book.</p>

      <!-- Duration selector -->
      {#if linkInfo && linkInfo.durations.length > 1}
        <div class="section">
          <span class="section-label">
            <Clock size={14} strokeWidth={1.5} />
            Duration
          </span>
          <div class="duration-chips">
            {#each linkInfo.durations as dur (dur)}
              <button
                class="chip"
                class:active={selectedDuration === dur}
                onclick={() => selectDuration(dur)}
              >
                {dur} min
              </button>
            {/each}
          </div>
        </div>
      {:else if linkInfo}
        <p class="duration-info">
          <Clock size={14} strokeWidth={1.5} />
          {selectedDuration} minute meeting
        </p>
      {/if}

      <!-- Date selector -->
      <div class="section">
        <span class="section-label">
          <Calendar size={14} strokeWidth={1.5} />
          Date
        </span>
        <div class="date-chips">
          {#each dateChips as chip (chip.value)}
            <button
              class="date-chip"
              class:active={selectedDate === chip.value}
              onclick={() => selectDate(chip.value)}
            >
              <span class="date-chip-day">{chip.dayName}</span>
              <span class="date-chip-date">{chip.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Available slots -->
      {#if selectedDate}
        <div class="section">
          <span class="section-label">Available times</span>
          {#if slotsLoading}
            <div class="slots-loading">
              <Loader size={18} strokeWidth={1.5} class="spin" />
              <span>Checking availability...</span>
            </div>
          {:else if slotsError}
            <div class="slots-error">{slotsError}</div>
          {:else if availableSlots.length === 0}
            <div class="slots-empty">No available times on this date. Try another day.</div>
          {:else}
            <div class="time-slots">
              {#each availableSlots as slot (slot.start)}
                <button class="time-slot" onclick={() => selectSlot(slot)}>
                  {formatTime(slot.start)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if step === 'form' || step === 'submitting'}
    <div class="booking-card">
      <button class="back-btn" onclick={goBackToSelect} disabled={step === 'submitting'}>
        <ChevronLeft size={16} strokeWidth={1.5} />
        Back
      </button>

      <h1 class="booking-title">{linkInfo?.name}</h1>

      {#if selectedSlot}
        <div class="selected-summary">
          <div class="summary-row">
            <Calendar size={14} strokeWidth={1.5} />
            <span>{formatDateLong(selectedSlot.start)}</span>
          </div>
          <div class="summary-row">
            <Clock size={14} strokeWidth={1.5} />
            <span>{formatTime(selectedSlot.start)} - {formatTime(selectedSlot.end)}</span>
            <span class="summary-duration">({selectedDuration} min)</span>
          </div>
        </div>
      {/if}

      <form
        class="booking-form"
        onsubmit={(e) => {
          e.preventDefault();
          submitBooking();
        }}
      >
        <div class="form-field">
          <label for="booking-name">
            <User size={14} strokeWidth={1.5} aria-hidden="true" />
            Name
          </label>
          <input
            id="booking-name"
            type="text"
            placeholder="Your name"
            bind:value={formName}
            required
            maxlength={BOOKING_NAME_MAX_LENGTH}
            disabled={step === 'submitting'}
            aria-invalid={formError.includes('Name') ? true : undefined}
            aria-describedby={formError ? 'booking-form-error' : undefined}
          />
        </div>

        <div class="form-field">
          <label for="booking-email">
            <Mail size={14} strokeWidth={1.5} aria-hidden="true" />
            Email
          </label>
          <input
            id="booking-email"
            type="email"
            placeholder="you@example.com"
            bind:value={formEmail}
            required
            maxlength={BOOKING_EMAIL_MAX_LENGTH}
            disabled={step === 'submitting'}
            aria-invalid={formError.includes('email') ? true : undefined}
            aria-describedby={formError ? 'booking-form-error' : undefined}
          />
        </div>

        <div class="form-field">
          <label for="booking-notes">
            <FileText size={14} strokeWidth={1.5} aria-hidden="true" />
            Notes <span class="optional">(optional)</span>
          </label>
          <textarea
            id="booking-notes"
            placeholder="Anything you'd like to share ahead of the meeting..."
            bind:value={formNotes}
            rows="3"
            maxlength={BOOKING_NOTES_MAX_LENGTH}
            disabled={step === 'submitting'}
          ></textarea>
        </div>

        {#if formError}
          <div class="form-error" id="booking-form-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="submit-btn" disabled={step === 'submitting'}>
          {#if step === 'submitting'}
            <Loader size={16} strokeWidth={1.5} class="spin" />
            Booking...
          {:else}
            Confirm Booking
          {/if}
        </button>
      </form>
    </div>
  {:else if step === 'confirmed'}
    <div class="booking-card confirmed-card">
      <div class="confirmed-icon">
        <CheckCircle size={48} strokeWidth={1.5} />
      </div>
      <h1 class="booking-title">Booking Confirmed</h1>
      <p class="booking-subtitle">You're all set. A calendar event has been created.</p>

      {#if confirmation}
        <div class="confirmed-details">
          <div class="summary-row">
            <Calendar size={14} strokeWidth={1.5} />
            <span>{formatDateLong(confirmation.start)}</span>
          </div>
          <div class="summary-row">
            <Clock size={14} strokeWidth={1.5} />
            <span>{formatTime(confirmation.start)} - {formatTime(confirmation.end)}</span>
            <span class="summary-duration">({confirmation.duration} min)</span>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .booking-page {
    width: 100%;
  }

  .booking-loading {
    @include flex-center;
    gap: var(--space-3);
    padding: var(--space-16) 0;
    color: var(--color-text-tertiary);
    font-size: 0.875rem;
  }

  .booking-error-card {
    @include card;
    @include flex-col(var(--space-3));
    align-items: center;
    text-align: center;
    padding: var(--space-12) var(--space-6);
    color: var(--color-text-tertiary);

    h2 {
      color: var(--color-text);
      font-size: 1.25rem;
      margin: 0;
    }

    p {
      margin: 0;
      font-size: 0.875rem;
    }
  }

  .booking-card {
    @include card;
    padding: var(--space-6);
    @include flex-col(var(--space-5));
  }

  .booking-title {
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .booking-subtitle {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    margin: 0;
    margin-top: calc(-1 * var(--space-2));
  }

  // Duration
  .duration-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    margin: 0;
  }

  .duration-chips {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .chip {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);

    &:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    &.active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-text);
    }
  }

  // Sections
  .section {
    @include flex-col(var(--space-3));
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  // Date chips
  .date-chips {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-2);
    -webkit-overflow-scrolling: touch;

    // Hide scrollbar but keep scrollable
    scrollbar-width: thin;
    &::-webkit-scrollbar {
      height: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--color-border);
      border-radius: 2px;
    }
  }

  .date-chip {
    @include flex-col;
    align-items: center;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    min-width: 64px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: none;
    cursor: pointer;
    transition: all var(--transition-fast);
    flex-shrink: 0;

    &:hover {
      border-color: var(--color-accent);
    }

    &.active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-text);

      .date-chip-day {
        color: var(--color-accent-text);
        opacity: 0.85;
      }
    }
  }

  .date-chip-day {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    letter-spacing: 0.02em;
  }

  .date-chip-date {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  // Slots
  .slots-loading {
    @include flex-center;
    gap: var(--space-2);
    padding: var(--space-6) 0;
    color: var(--color-text-tertiary);
    font-size: 0.875rem;
  }

  .slots-error {
    padding: var(--space-3) var(--space-4);
    background: var(--color-danger-muted);
    color: var(--color-danger);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
  }

  .slots-empty {
    padding: var(--space-6) 0;
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 0.875rem;
  }

  .time-slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: var(--space-2);
  }

  .time-slot {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
    text-align: center;

    &:hover {
      border-color: var(--color-accent);
      background: var(--color-accent-muted);
      color: var(--color-accent);
    }
  }

  // Back button
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--transition-fast);
    align-self: flex-start;

    &:hover {
      color: var(--color-text);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  // Selected summary
  .selected-summary {
    @include flex-col(var(--space-2));
    padding: var(--space-3) var(--space-4);
    background: var(--color-accent-muted);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
  }

  .summary-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .summary-duration {
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  // Form
  .booking-form {
    @include flex-col(var(--space-4));
  }

  .booking-form .form-field {
    @include flex-col(var(--space-1));

    label {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    input,
    textarea {
      padding: var(--space-2) var(--space-3);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text);
      font-size: 0.875rem;
      font-family: inherit;
      transition: border-color var(--transition-fast);
      resize: vertical;

      &:focus {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
        border-color: var(--color-accent);
      }

      &::placeholder {
        color: var(--color-text-tertiary);
      }

      &:disabled {
        opacity: 0.6;
      }
    }
  }

  .optional {
    font-weight: 400;
    color: var(--color-text-tertiary);
  }

  .form-error {
    padding: var(--space-2) var(--space-4);
    background: var(--color-danger-muted);
    color: var(--color-danger);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
  }

  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.875rem;
    font-weight: 500;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast);
    width: 100%;

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
    }

    &:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
  }

  // Confirmed
  .confirmed-card {
    align-items: center;
    text-align: center;
  }

  .confirmed-icon {
    color: var(--color-success);
  }

  .confirmed-details {
    @include flex-col(var(--space-2));
    padding: var(--space-3) var(--space-4);
    background: var(--color-success-muted);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    width: 100%;
  }
</style>
