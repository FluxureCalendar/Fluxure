<script lang="ts">
  import { onMount } from 'svelte';
  import { pageTitle } from '$lib/brand';
  import { habits } from '$lib/api';
  import type { Habit } from '@fluxure/shared';
  import { showToast } from '$lib/toast.svelte';
  import { formatDuration } from '$lib/utils/format';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import EntityCard from '$lib/components/EntityCard.svelte';
  import HabitForm from './HabitForm.svelte';

  import Plus from 'lucide-svelte/icons/plus';
  import Flame from 'lucide-svelte/icons/flame';
  import Clock from 'lucide-svelte/icons/clock';
  import Repeat from 'lucide-svelte/icons/repeat';
  import Pause from 'lucide-svelte/icons/pause';

  let habitList = $state<Habit[]>([]);
  let loading = $state(true);
  let formOpen = $state(false);
  let editingHabit = $state<Habit | null>(null);
  let confirmDeleteId = $state<string | null>(null);
  let loadError = $state('');

  async function loadHabits() {
    try {
      loadError = '';
      habitList = await habits.list();
    } catch (err) {
      console.error('Failed to load habits:', err);
      loadError = 'Failed to load habits. Please try again.';
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editingHabit = null;
    formOpen = true;
  }

  function openEdit(h: Habit) {
    editingHabit = h;
    formOpen = true;
  }

  function toggleHabit(h: Habit) {
    const newEnabled = !h.enabled;
    habitList = habitList.map((x) => (x.id === h.id ? { ...x, enabled: newEnabled } : x));
    habits.update(h.id, { enabled: newEnabled }).catch(() => {
      habitList = habitList.map((x) => (x.id === h.id ? { ...x, enabled: !newEnabled } : x));
      showToast('Failed to update habit', 'error');
    });
  }

  async function deleteHabit(h: Habit) {
    confirmDeleteId = null;
    try {
      await habits.delete(h.id);
      habitList = habitList.filter((x) => x.id !== h.id);
      showToast('Habit deleted', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to delete habit', 'error');
      }
    }
  }

  function formatFrequency(h: Habit): string {
    if (h.days.length === 7) return 'Daily';
    const dayMap: Record<string, string> = {
      mon: 'Mo',
      tue: 'Tu',
      wed: 'We',
      thu: 'Th',
      fri: 'Fr',
      sat: 'Sa',
      sun: 'Su',
    };
    return h.days.map((d) => dayMap[d] || d).join('');
  }

  function formatTimeAmPm(time: string): string {
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr);
    const m = parseInt(mStr || '0');
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h >= 12 ? 'PM' : 'AM';
    return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  onMount(async () => {
    await loadHabits();
    const editId = new URL(window.location.href).searchParams.get('edit');
    if (editId) {
      const habit = habitList.find((h) => h.id === editId);
      if (habit) openEdit(habit);
      window.history.replaceState({}, '', '/habits');
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Habits')}</title>
</svelte:head>

<PageHeader title="Habits" subtitle="Build routines that get protected time on your calendar">
  {#if !loading && habitList.length > 0}
    <button class="btn-primary" onclick={openCreate}>
      <Plus size={16} /> Add habit
    </button>
  {/if}
</PageHeader>

{#if !loading}
  {#if loadError}
    <div class="load-error">
      <p>{loadError}</p>
      <button onclick={loadHabits}>Retry</button>
    </div>
  {:else if habitList.length === 0}
    <EmptyState
      icon={Flame}
      title="No habits yet"
      message="Create your first habit to start building consistency."
      actionLabel="Create habit"
      onaction={openCreate}
    />
  {:else}
    <div class="habits-grid">
      {#each habitList as h, i (h.id)}
        <EntityCard
          name={h.name}
          color={h.color || 'var(--color-accent)'}
          paused={h.enabled === false}
          index={i}
          confirmingDelete={confirmDeleteId === h.id}
          onclick={() => openEdit(h)}
          ondelete={() => (confirmDeleteId = h.id)}
          onconfirmdelete={() => deleteHabit(h)}
          oncanceldelete={() => (confirmDeleteId = null)}
        >
          {#snippet chips()}
            <span class="entity-chip">
              <Clock size={11} />
              {formatDuration(h.durationMin)}{h.durationMax !== h.durationMin
                ? `\u2013${formatDuration(h.durationMax)}`
                : ''}
            </span>
            <span class="entity-chip">
              <Repeat size={11} />
              {formatFrequency(h)}
            </span>
            {#if h.enabled === false}
              <span class="entity-chip entity-chip-paused">
                <Pause size={11} />
                Paused
              </span>
            {/if}
          {/snippet}

          {#snippet detail()}
            <span>{formatTimeAmPm(h.windowStart)} – {formatTimeAmPm(h.windowEnd)}</span>
            {#if h.idealTime}
              <span>Ideal: {formatTimeAmPm(h.idealTime)}</span>
            {/if}
          {/snippet}

          {#snippet footer()}
            <button
              class="toggle-switch toggle-sm"
              class:toggle-on={h.enabled !== false}
              onclick={() => toggleHabit(h)}
              role="switch"
              aria-checked={h.enabled !== false}
              aria-label="Enable {h.name}"
            ></button>
          {/snippet}
        </EntityCard>
      {/each}
    </div>
  {/if}
{/if}

<HabitForm
  open={formOpen}
  habit={editingHabit}
  onclose={() => {
    formOpen = false;
  }}
  onsaved={loadHabits}
/>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .habits-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-3);

    @include mobile {
      grid-template-columns: 1fr;
    }
  }

  .toggle-sm {
    transform: scale(0.85);
    transform-origin: left center;
  }
</style>
