<script lang="ts">
  import { onMount } from 'svelte';
  import { auth, schedule, type SessionInfo } from '$lib/api';
  import { getAuthState, logout } from '$lib/auth.svelte';
  import { showToast } from '$lib/toast.svelte';

  import { SvelteSet } from 'svelte/reactivity';
  import Download from 'lucide-svelte/icons/download';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import LogOut from 'lucide-svelte/icons/log-out';
  import Monitor from 'lucide-svelte/icons/monitor';
  import CalendarX2 from 'lucide-svelte/icons/calendar-x-2';

  const authState = getAuthState();

  let sessions = $state<SessionInfo[]>([]);
  let loadingSessions = $state(true);
  let exporting = $state(false);

  const exportCategories = [
    { key: 'profile', label: 'Profile' },
    { key: 'habits', label: 'Habits' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'meetings', label: 'Meetings' },
    { key: 'focus', label: 'Focus blocks' },
    { key: 'calendars', label: 'Calendars' },
    { key: 'calendarEvents', label: 'Calendar events' },
    { key: 'scheduledEvents', label: 'Scheduled events' },
    { key: 'habitCompletions', label: 'Habit completions' },
    { key: 'activityLog', label: 'Activity log' },
    { key: 'scheduleChanges', label: 'Schedule changes' },
    { key: 'schedulingLinks', label: 'Scheduling links' },
    { key: 'schedulingTemplates', label: 'Scheduling templates' },
  ] as const;

  let selectedCategories: SvelteSet<string> = new SvelteSet(exportCategories.map((c) => c.key));

  function toggleCategory(key: string) {
    const next = new SvelteSet(selectedCategories);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedCategories = next;
  }

  function toggleAll() {
    if (selectedCategories.size === exportCategories.length) {
      selectedCategories = new SvelteSet();
    } else {
      selectedCategories = new SvelteSet(exportCategories.map((c) => c.key));
    }
  }
  let revokingAll = $state(false);

  // Two-click confirmation for managed events
  let confirmDeleteEvents = $state(false);
  let deletingEvents = $state(false);
  let eventTimer: ReturnType<typeof setTimeout> | null = null;

  // Type-to-confirm for account deletion
  let deleteConfirm = $state('');
  let deletingAccount = $state(false);

  function resetConfirmEvents() {
    confirmDeleteEvents = false;
    if (eventTimer) clearTimeout(eventTimer);
  }

  async function loadSessions() {
    try {
      const result = await auth.getSessions();
      sessions = result.sessions;
    } catch {
      // silent
    } finally {
      loadingSessions = false;
    }
  }

  async function exportData() {
    if (exporting) return;
    exporting = true;
    try {
      await auth.requestExport([...selectedCategories]);
      showToast('Data export requested. Check your email.', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast(err.message || 'Failed to request export', 'error');
      }
    } finally {
      exporting = false;
    }
  }

  async function revokeOtherSessions() {
    if (revokingAll) return;
    revokingAll = true;
    try {
      await auth.revokeOtherSessions();
      sessions = sessions.filter((s) => s.current);
      showToast('All other sessions revoked', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to revoke sessions', 'error');
      }
    } finally {
      revokingAll = false;
    }
  }

  async function revokeSession(id: string) {
    try {
      await auth.revokeSession(id);
      sessions = sessions.filter((s) => s.id !== id);
      showToast('Session revoked', 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to revoke session', 'error');
      }
    }
  }

  function handleDeleteEventsClick() {
    if (!confirmDeleteEvents) {
      confirmDeleteEvents = true;
      eventTimer = setTimeout(() => resetConfirmEvents(), 4000);
      return;
    }
    executeDeleteEvents();
  }

  async function executeDeleteEvents() {
    if (deletingEvents) return;
    deletingEvents = true;
    try {
      const result = await schedule.deleteAllManaged();
      showToast(`Deleted ${result.googleEventsDeleted} managed events`, 'success');
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast(err.message || 'Failed to delete events', 'error');
      }
    } finally {
      deletingEvents = false;
      resetConfirmEvents();
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'delete' || deletingAccount) return;
    deletingAccount = true;
    try {
      await auth.deleteAccount(undefined, authState.user?.email);
      showToast('Account deleted', 'success');
      await logout();
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast(err.message || 'Failed to delete account', 'error');
      }
    } finally {
      deletingAccount = false;
    }
  }

  function formatAgent(ua: string | null): string {
    if (!ua) return 'Unknown device';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return 'Browser';
  }

  onMount(() => {
    loadSessions();
    return () => {
      if (eventTimer) clearTimeout(eventTimer);
    };
  });
</script>

<section class="settings-section">
  <h3>Privacy & data</h3>

  <div class="setting-block" data-setting-id="privacy-export">
    <h4>Export my data</h4>
    <p class="desc">
      Select which data to include, then export as JSON. You'll receive an email with the file.
    </p>

    <div class="export-categories">
      <label class="export-toggle-all">
        <input
          type="checkbox"
          checked={selectedCategories.size === exportCategories.length}
          indeterminate={selectedCategories.size > 0 &&
            selectedCategories.size < exportCategories.length}
          onchange={toggleAll}
        />
        <span>Select all</span>
      </label>
      <div class="export-grid">
        {#each exportCategories as cat (cat.key)}
          <label class="export-category">
            <input
              type="checkbox"
              checked={selectedCategories.has(cat.key)}
              onchange={() => toggleCategory(cat.key)}
            />
            <span>{cat.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <button
      class="btn-secondary"
      onclick={exportData}
      disabled={exporting || selectedCategories.size === 0}
    >
      <Download size={14} />
      {exporting
        ? 'Requesting...'
        : `Export ${selectedCategories.size} ${selectedCategories.size === 1 ? 'category' : 'categories'}`}
    </button>
  </div>

  <div class="setting-block" data-setting-id="privacy-sessions">
    <h4>Active sessions</h4>
    {#if loadingSessions}
      <p class="desc">Loading sessions...</p>
    {:else if sessions.length > 0}
      <div class="session-list">
        {#each sessions as session (session.id)}
          <div class="session-row">
            <div class="session-info">
              <Monitor size={14} />
              <span class="session-agent">{formatAgent(session.userAgent)}</span>
              {#if session.current}
                <span class="badge-success">Current</span>
              {/if}
            </div>
            <div class="session-meta">
              <span>{new Date(session.createdAt).toLocaleDateString()}</span>
              {#if !session.current}
                <button
                  class="btn-ghost session-revoke"
                  onclick={() => revokeSession(session.id)}
                  aria-label="Revoke session"
                >
                  Revoke
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if sessions.length > 1}
        <button class="btn-secondary" onclick={revokeOtherSessions} disabled={revokingAll}>
          <LogOut size={14} />
          {revokingAll ? 'Revoking...' : 'Sign out everywhere else'}
        </button>
      {/if}
    {:else}
      <p class="desc">No active sessions found.</p>
    {/if}
  </div>
</section>

<section class="settings-section settings-danger">
  <h3 class="danger-heading">Danger zone</h3>

  <div class="setting-block">
    <h4>Delete managed events</h4>
    <p class="desc">
      Remove all Fluxure-created events from your Google Calendar. Your habits, tasks, and settings
      will remain.
    </p>
    <button
      class="btn-danger"
      class:btn-confirming={confirmDeleteEvents}
      onclick={handleDeleteEventsClick}
      disabled={deletingEvents}
    >
      <CalendarX2 size={14} />
      {#if deletingEvents}
        Deleting...
      {:else if confirmDeleteEvents}
        Are you sure?
      {:else}
        Delete managed events
      {/if}
    </button>
  </div>

  <div class="setting-block" data-setting-id="account-delete">
    <h4>Delete account</h4>
    <p class="desc">Permanently delete your account and all data. This cannot be undone.</p>
    <div class="form-field">
      <label class="form-label" for="delete-confirm">Type "delete" to confirm</label>
      <input
        id="delete-confirm"
        class="form-input"
        bind:value={deleteConfirm}
        placeholder="delete"
      />
    </div>
    <button
      class="btn-danger"
      onclick={handleDeleteAccount}
      disabled={deleteConfirm !== 'delete' || deletingAccount}
    >
      <Trash2 size={14} />
      {deletingAccount ? 'Deleting...' : 'Delete my account'}
    </button>
  </div>
</section>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-section {
    @include flex-col(var(--space-4));
  }

  .settings-danger {
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .setting-block {
    @include flex-col(var(--space-3));
  }

  h4 {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
  }

  .desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .session-list {
    @include flex-col;
  }

  .session-row {
    @include flex-between;
    padding: var(--space-2) 0;
    font-size: 0.8125rem;

    & + & {
      border-top: 1px solid var(--color-border);
    }
  }

  .session-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text);
  }

  .session-agent {
    font-size: 0.875rem;
  }

  .session-meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-tertiary);
    font-size: 0.75rem;
  }

  .session-revoke {
    height: 24px;
    font-size: 0.75rem;
    padding: 0 var(--space-2);
    color: var(--color-danger);

    &:hover {
      color: var(--color-danger);
    }
  }

  .export-categories {
    @include flex-col(var(--space-2));
  }

  .export-toggle-all {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--color-border);
  }

  .export-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-1) var(--space-4);
  }

  .export-category {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);
    cursor: pointer;
    padding: var(--space-1) 0;
    border-radius: var(--radius-sm, 4px);
    transition: color 0.15s ease;

    &:hover {
      color: var(--color-accent);
    }

    input:not(:checked) + span {
      color: var(--color-text-tertiary);
    }
  }

  .danger-heading {
    color: var(--color-danger);
  }

  .btn-confirming {
    background: var(--color-danger-muted);
    border-color: var(--color-danger);
    animation: pulse-danger 1s ease-in-out infinite;
  }

  @keyframes pulse-danger {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.8;
    }
  }
</style>
