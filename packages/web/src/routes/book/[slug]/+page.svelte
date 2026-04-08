<script lang="ts">
  import { page } from '$app/stores';
  import { links } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { pageTitle } from '$lib/brand';
  import Clock from 'lucide-svelte/icons/clock';
  import CalendarDays from 'lucide-svelte/icons/calendar-days';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';

  interface Slot {
    start: string;
    end: string;
    duration: number;
  }

  let slug = $derived($page.params.slug);
  let loading = $state(true);
  let error = $state('');
  let linkData = $state<{ slug: string; slots: Slot[] } | null>(null);

  // Booking form
  let selectedDate = $state('');
  let selectedSlot = $state<Slot | null>(null);
  let guestName = $state('');
  let guestEmail = $state('');
  let notes = $state('');
  let booking = $state(false);
  let booked = $state(false);

  // Group slots by date
  const slotsByDate = $derived.by(() => {
    if (!linkData?.slots) return new SvelteMap<string, Slot[]>();
    const map = new SvelteMap<string, Slot[]>();
    for (const slot of linkData.slots) {
      const date = slot.start.split('T')[0];
      const existing = map.get(date) ?? [];
      map.set(date, [...existing, slot]);
    }
    return map;
  });

  const availableDates = $derived([...slotsByDate.keys()].sort());
  const slotsForDate = $derived(selectedDate ? (slotsByDate.get(selectedDate) ?? []) : []);

  $effect(() => {
    loadAvailability();
  });

  async function loadAvailability() {
    loading = true;
    error = '';

    try {
      linkData = await links.getBySlug(slug ?? '');
      if (availableDates.length > 0) {
        selectedDate = availableDates[0];
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load availability.';
    } finally {
      loading = false;
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTime(isoStr: string): string {
    const date = new Date(isoStr);
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  async function handleBook() {
    if (!selectedSlot || !guestName.trim() || !guestEmail.trim()) return;

    booking = true;

    try {
      const { PUBLIC_API_URL } = await import('$env/static/public');
      const API_BASE = PUBLIC_API_URL || 'http://localhost:3000/api';
      const res = await fetch(`${API_BASE}/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: selectedSlot.start,
          end: selectedSlot.end,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          notes: notes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Booking failed (${res.status})`);
      }

      booked = true;
    } catch (err) {
      if (err instanceof Error && err.message === 'Booking confirmed') return;
      showToast(err instanceof Error ? err.message : 'Booking failed', 'error');
    } finally {
      booking = false;
    }
  }
</script>

<svelte:head>
  <title>{linkData ? `Book a time — ${slug}` : pageTitle('Book a time')}</title>
</svelte:head>

<div class="booking-page">
  {#if loading}
    <div class="booking-loading">
      <div class="spinner"></div>
      <p>Loading availability...</p>
    </div>
  {:else if error}
    <div class="booking-error">
      <AlertCircle size={40} />
      <h2>Unavailable</h2>
      <p>{error}</p>
    </div>
  {:else if booked}
    <div class="booking-confirmed">
      <CheckCircle size={48} class="confirmed-icon" />
      <h2>Booking confirmed</h2>
      <p>You'll receive a calendar invite at <strong>{guestEmail}</strong>.</p>
    </div>
  {:else}
    <div class="booking-content">
      <h2 class="booking-title">Choose a time</h2>

      {#if availableDates.length === 0}
        <p class="no-slots">No available time slots at the moment.</p>
      {:else}
        <div class="date-picker">
          <div class="date-tabs">
            {#each availableDates as date (date)}
              <button
                class="date-tab"
                class:date-tab-active={date === selectedDate}
                onclick={() => {
                  selectedDate = date;
                  selectedSlot = null;
                }}
              >
                {formatDate(date)}
              </button>
            {/each}
          </div>
        </div>

        {#if slotsForDate.length > 0}
          <div class="time-slots">
            {#each slotsForDate as slot (slot.start)}
              <button
                class="time-slot"
                class:time-slot-selected={selectedSlot === slot}
                onclick={() => (selectedSlot = slot)}
              >
                <Clock size={14} />
                <span>{formatTime(slot.start)}</span>
                <span class="slot-duration">{slot.duration}min</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if selectedSlot}
          <form
            class="booking-form"
            onsubmit={(e) => {
              e.preventDefault();
              handleBook();
            }}
          >
            <div class="selected-time">
              <CalendarDays size={16} />
              <span>{formatDate(selectedDate)} at {formatTime(selectedSlot.start)}</span>
            </div>

            <div class="form-field">
              <label class="form-label" for="guest-name">Your name</label>
              <input
                id="guest-name"
                class="form-input"
                type="text"
                bind:value={guestName}
                placeholder="Your name"
                required
              />
            </div>

            <div class="form-field">
              <label class="form-label" for="guest-email">Email</label>
              <input
                id="guest-email"
                class="form-input"
                type="email"
                bind:value={guestEmail}
                placeholder="you@example.com"
                required
              />
            </div>

            <div class="form-field">
              <label class="form-label" for="notes">Notes (optional)</label>
              <textarea
                id="notes"
                class="form-textarea"
                bind:value={notes}
                placeholder="Anything you'd like to share"
                rows="3"
              ></textarea>
            </div>

            <button class="btn-primary book-btn" type="submit" disabled={booking}>
              {booking ? 'Booking...' : 'Confirm booking'}
            </button>
          </form>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .booking-page {
    width: 100%;
    max-width: 560px;
  }

  .booking-loading,
  .booking-error,
  .booking-confirmed {
    @include flex-center;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-16) 0;
    text-align: center;
  }

  .booking-error {
    color: var(--color-text-secondary);

    h2 {
      font-family: var(--font-heading, 'Fraunces', Georgia, serif);
      font-weight: 600;
      font-size: 1.5rem;
      color: var(--color-text);
    }

    :global(svg) {
      color: var(--color-danger);
    }
  }

  .booking-confirmed {
    h2 {
      font-family: var(--font-heading, 'Fraunces', Georgia, serif);
      font-weight: 600;
      font-size: 1.5rem;
      color: var(--color-text);
    }

    p {
      color: var(--color-text-secondary);
    }
  }

  :global(.confirmed-icon) {
    color: var(--color-success);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .booking-content {
    @include card;
    padding: var(--space-8);
  }

  .booking-title {
    font-family: var(--font-heading, 'Fraunces', Georgia, serif);
    font-weight: 600;
    font-size: 1.5rem;
    letter-spacing: -0.015em;
    margin-bottom: var(--space-6);
  }

  .no-slots {
    color: var(--color-text-secondary);
    text-align: center;
    padding: var(--space-8) 0;
  }

  .date-tabs {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .date-tab {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }

    &.date-tab-active {
      background: var(--color-accent);
      color: var(--color-accent-text);
      border-color: var(--color-accent);
    }
  }

  .time-slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-6);
  }

  .time-slot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--color-surface-hover);
    }

    &.time-slot-selected {
      border-color: var(--color-accent);
      background: var(--color-accent-muted);
    }
  }

  .slot-duration {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .booking-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-6);
    animation: calmEnter 200ms ease;
  }

  .selected-time {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-accent-muted);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-accent);
  }

  .book-btn {
    width: 100%;
    height: 40px;
  }
</style>
