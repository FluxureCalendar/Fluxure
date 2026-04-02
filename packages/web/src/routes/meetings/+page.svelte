<script lang="ts">
  import { onMount } from 'svelte';
  import { pageTitle } from '$lib/brand';
  import { meetings } from '$lib/api';
  import type { SmartMeeting } from '@fluxure/shared';
  import { showToast } from '$lib/toast.svelte';
  import { formatDuration } from '$lib/utils/format';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import SkeletonLoader from '$lib/components/SkeletonLoader.svelte';
  import EntityCard from '$lib/components/EntityCard.svelte';
  import MeetingForm from './MeetingForm.svelte';

  import Plus from 'lucide-svelte/icons/plus';
  import Users from 'lucide-svelte/icons/users';
  import Clock from 'lucide-svelte/icons/clock';
  import Repeat from 'lucide-svelte/icons/repeat';
  import Video from 'lucide-svelte/icons/video';
  import Pause from 'lucide-svelte/icons/pause';

  let meetingList = $state<SmartMeeting[]>([]);
  let loading = $state(true);
  let formOpen = $state(false);
  let editingMeeting = $state<SmartMeeting | null>(null);
  let confirmDeleteId = $state<string | null>(null);
  let loadError = $state('');

  async function loadMeetings() {
    try {
      loadError = '';
      meetingList = await meetings.list();
    } catch (err) {
      console.error('Failed to load meetings:', err);
      loadError = 'Failed to load meetings. Please try again.';
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editingMeeting = null;
    formOpen = true;
  }

  function openEdit(m: SmartMeeting) {
    editingMeeting = m;
    formOpen = true;
  }

  function toggleMeeting(m: SmartMeeting) {
    const newEnabled = !m.enabled;
    meetingList = meetingList.map((x) => (x.id === m.id ? { ...x, enabled: newEnabled } : x));
    meetings.update(m.id, { enabled: newEnabled } as any).catch(() => {
      meetingList = meetingList.map((x) => (x.id === m.id ? { ...x, enabled: !newEnabled } : x));
      showToast('Failed to update meeting', 'error');
    });
  }

  async function deleteMeeting(m: SmartMeeting) {
    confirmDeleteId = null;
    try {
      await meetings.delete(m.id);
      meetingList = meetingList.filter((x) => x.id !== m.id);
      showToast('Meeting deleted', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to delete meeting', 'error');
      }
    }
  }

  function formatFrequency(m: SmartMeeting): string {
    if (m.frequency === 'daily') return 'Daily';
    if (m.frequency === 'weekly') return 'Weekly';
    if (m.frequency === 'monthly') return 'Monthly';
    if (m.frequencyConfig?.days) {
      const dayMap: Record<string, string> = {
        mon: 'Mo',
        tue: 'Tu',
        wed: 'We',
        thu: 'Th',
        fri: 'Fr',
        sat: 'Sa',
        sun: 'Su',
      };
      return m.frequencyConfig.days.map((d) => dayMap[d] || d).join('');
    }
    return m.frequency;
  }

  function conferenceLabel(type: string): string {
    switch (type) {
      case 'google_meet':
        return 'Meet';
      case 'zoom':
        return 'Zoom';
      case 'teams':
        return 'Teams';
      default:
        return '';
    }
  }

  onMount(async () => {
    await loadMeetings();
    const editId = new URL(window.location.href).searchParams.get('edit');
    if (editId) {
      const meeting = meetingList.find((m) => m.id === editId);
      if (meeting) openEdit(meeting);
      window.history.replaceState({}, '', '/meetings');
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Meetings')}</title>
</svelte:head>

<PageHeader title="Meetings" subtitle="Recurring meetings that get auto-scheduled to the best time">
  <button class="btn-primary" onclick={openCreate}>
    <Plus size={16} /> Add meeting
  </button>
</PageHeader>

{#if loading}
  <SkeletonLoader lines={5} />
{:else if loadError}
  <div class="load-error">
    <p>{loadError}</p>
    <button onclick={loadMeetings}>Retry</button>
  </div>
{:else if meetingList.length === 0}
  <EmptyState
    icon={Users}
    title="No meetings yet"
    message="Create a recurring meeting and let the scheduler find the best time for it."
    actionLabel="Create meeting"
    onaction={openCreate}
  />
{:else}
  <div class="meetings-grid">
    {#each meetingList as m (m.id)}
      <EntityCard
        name={m.name}
        color={m.color || 'var(--color-accent)'}
        paused={!m.enabled}
        confirmingDelete={confirmDeleteId === m.id}
        onclick={() => openEdit(m)}
        ondelete={() => (confirmDeleteId = m.id)}
        onconfirmdelete={() => deleteMeeting(m)}
        oncanceldelete={() => (confirmDeleteId = null)}
      >
        {#snippet chips()}
          <span class="entity-chip">
            <Clock size={11} />
            {formatDuration(m.duration)}
          </span>
          <span class="entity-chip">
            <Repeat size={11} />
            {formatFrequency(m)}
          </span>
          {#if m.attendees.length > 0}
            <span class="entity-chip">
              <Users size={11} />
              {m.attendees.length}
            </span>
          {/if}
          {#if m.conferenceType && m.conferenceType !== 'none'}
            <span class="entity-chip">
              <Video size={11} />
              {conferenceLabel(m.conferenceType)}
            </span>
          {/if}
          {#if !m.enabled}
            <span class="entity-chip entity-chip-paused">
              <Pause size={11} />
              Paused
            </span>
          {/if}
        {/snippet}

        {#snippet footer()}
          <button
            class="toggle-switch toggle-sm"
            class:toggle-on={m.enabled}
            onclick={() => toggleMeeting(m)}
            role="switch"
            aria-checked={m.enabled}
            aria-label="Enable {m.name}"
          ></button>
        {/snippet}
      </EntityCard>
    {/each}
  </div>
{/if}

<MeetingForm
  open={formOpen}
  meeting={editingMeeting}
  onclose={() => {
    formOpen = false;
  }}
  onsaved={loadMeetings}
/>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .meetings-grid {
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
