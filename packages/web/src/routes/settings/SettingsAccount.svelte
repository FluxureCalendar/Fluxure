<script lang="ts">
  import { resolve } from '$app/paths';
  import { SvelteSet } from 'svelte/reactivity';
  import { auth as authApi } from '$lib/api';
  import type { SessionInfo } from '$lib/api';
  import { showSuccess } from '$lib/notifications.svelte';
  import Monitor from 'lucide-svelte/icons/monitor';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Download from 'lucide-svelte/icons/download';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Shield from 'lucide-svelte/icons/shield';

  interface Props {
    userName: string;
    userEmail: string;
    userAvatarUrl: string | null;
    userHasPassword: boolean;
    initials: string;
    sessionList: SessionInfo[];
    googleConnected: boolean;
    // Handlers
    onexportdata: (categories: string[]) => void | Promise<void>;
    onexportcalendar: () => void | Promise<void>;
    onrevokesession: (id: string) => void;
    onrevokeothersessions: () => void;
    ondeleteaccount: (email: string, password: string) => void | Promise<void>;
    onnukeevents: (confirmText: string) => void | Promise<void>;
    oncanceldanger: () => void;
    exporting: boolean;
    exportingCalendar: boolean;
    revokingAll: boolean;
  }

  let {
    userName,
    userEmail,
    userAvatarUrl = $bindable(),
    userHasPassword,
    initials,
    sessionList,
    googleConnected,
    onexportdata,
    onexportcalendar,
    onrevokesession,
    onrevokeothersessions,
    ondeleteaccount,
    onnukeevents,
    oncanceldanger,
    exporting,
    exportingCalendar,
    revokingAll,
  }: Props = $props();

  // Account deletion
  let confirmingDelete = $state(false);
  let deleteConfirmEmail = $state('');
  let deleting = $state(false);
  let deletePassword = $state('');

  // Export form
  let exportExpanded = $state(false);
  const exportCategories = [
    { label: 'Profile & settings', value: 'profile' },
    { label: 'Habits', value: 'habits' },
    { label: 'Habit completions', value: 'habitCompletions' },
    { label: 'Tasks & subtasks', value: 'tasks' },
    { label: 'Meetings', value: 'meetings' },
    { label: 'Focus time rules', value: 'focus' },
    { label: 'Buffer settings', value: 'buffers' },
    { label: 'Calendar configuration', value: 'calendars' },
    { label: 'External calendar events', value: 'calendarEvents' },
    { label: 'Scheduled events', value: 'scheduledEvents' },
    { label: 'Activity log', value: 'activityLog' },
    { label: 'Schedule changes', value: 'scheduleChanges' },
    { label: 'Scheduling links', value: 'schedulingLinks' },
    { label: 'Scheduling templates', value: 'schedulingTemplates' },
  ] as const;
  type ExportCategory = (typeof exportCategories)[number]['value'];
  const selectedCategories = new SvelteSet<ExportCategory>(exportCategories.map((c) => c.value));
  let allSelected = $derived(selectedCategories.size === exportCategories.length);

  function resetCategories() {
    selectedCategories.clear();
    for (const c of exportCategories) selectedCategories.add(c.value);
  }

  function toggleSelectAll() {
    if (allSelected) {
      selectedCategories.clear();
    } else {
      resetCategories();
    }
  }

  function toggleCategory(value: ExportCategory) {
    if (selectedCategories.has(value)) {
      selectedCategories.delete(value);
    } else {
      selectedCategories.add(value);
    }
  }

  async function handleExportSubmit() {
    await onexportdata([...selectedCategories]);
    exportExpanded = false;
    resetCategories();
  }

  // Danger zone
  let confirmingDanger = $state(false);
  let dangerConfirmText = $state('');
  let nuking = $state(false);

  async function handleDangerClick() {
    if (!confirmingDanger) {
      confirmingDanger = true;
      return;
    }
    if (dangerConfirmText !== 'DELETE') return;
    nuking = true;
    try {
      await onnukeevents(dangerConfirmText);
    } finally {
      nuking = false;
      confirmingDanger = false;
      dangerConfirmText = '';
    }
  }

  function cancelDanger() {
    confirmingDanger = false;
    dangerConfirmText = '';
    oncanceldanger();
  }

  async function handleDeleteAccount() {
    if (deleteConfirmEmail !== userEmail) return;
    deleting = true;
    try {
      await ondeleteaccount(deleteConfirmEmail, userHasPassword ? deletePassword : '');
    } finally {
      deleting = false;
    }
  }

  // Change password
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmNewPassword = $state('');
  let changingPassword = $state(false);
  let passwordError = $state('');
  let passwordSuccess = $state('');

  async function handleChangePassword(e: Event) {
    e.preventDefault();
    passwordError = '';
    passwordSuccess = '';

    if (newPassword !== confirmNewPassword) {
      passwordError = 'New passwords do not match.';
      return;
    }
    if (newPassword.length < 8) {
      passwordError = 'New password must be at least 8 characters.';
      return;
    }

    changingPassword = true;
    try {
      await authApi.changePassword(currentPassword, newPassword);
      passwordSuccess = 'Password changed successfully.';
      currentPassword = '';
      newPassword = '';
      confirmNewPassword = '';
    } catch (err: unknown) {
      passwordError = err instanceof Error ? err.message : 'Failed to change password.';
    } finally {
      changingPassword = false;
    }
  }

  // Withdraw GDPR consent
  let confirmWithdraw = $state(false);
  let withdrawing = $state(false);
  let withdrawError = $state('');

  async function handleWithdrawConsent() {
    withdrawError = '';
    withdrawing = true;
    try {
      await authApi.withdrawConsent();
      showSuccess('Consent withdrawn. Scheduling has been paused.');
      confirmWithdraw = false;
    } catch (err: unknown) {
      withdrawError = err instanceof Error ? err.message : 'Failed to withdraw consent.';
    } finally {
      withdrawing = false;
    }
  }
</script>

<!-- Account -->
<hr class="section-divider" />

<section aria-labelledby="account-heading" class="settings-section">
  <h2 id="account-heading" class="section-heading">Account</h2>

  <div class="account-info">
    <div class="account-avatar">
      {#if userAvatarUrl}
        <img
          src={userAvatarUrl}
          alt=""
          class="account-avatar-img"
          referrerpolicy="no-referrer"
          onerror={() => {
            userAvatarUrl = null;
          }}
        />
      {:else}
        {initials}
      {/if}
    </div>
    <div class="account-details">
      <span class="account-name">{userName || 'No name set'}</span>
      <span class="account-email">{userEmail}</span>
    </div>
  </div>
</section>

<!-- Change Password -->
{#if userHasPassword}
  <hr class="section-divider" />

  <section aria-labelledby="password-heading" class="settings-section">
    <h2 id="password-heading" class="section-heading">Change Password</h2>
    <form onsubmit={handleChangePassword} class="change-password-form">
      <div class="form-field">
        <label for="current-pw">Current Password</label>
        <input
          id="current-pw"
          type="password"
          bind:value={currentPassword}
          autocomplete="current-password"
          required
        />
      </div>
      <div class="form-field">
        <label for="new-pw">New Password</label>
        <input
          id="new-pw"
          type="password"
          bind:value={newPassword}
          autocomplete="new-password"
          required
          minlength="8"
        />
      </div>
      <div class="form-field">
        <label for="confirm-pw">Confirm New Password</label>
        <input
          id="confirm-pw"
          type="password"
          bind:value={confirmNewPassword}
          autocomplete="new-password"
          required
        />
      </div>
      {#if passwordError}<p class="alert-error">{passwordError}</p>{/if}
      {#if passwordSuccess}<p class="alert-success">{passwordSuccess}</p>{/if}
      <button type="submit" class="btn-action btn-action--primary" disabled={changingPassword}>
        {changingPassword ? 'Changing...' : 'Change Password'}
      </button>
    </form>
  </section>
{/if}

<!-- Privacy & Data -->
<hr class="section-divider" />

<section aria-labelledby="privacy-heading" class="settings-section">
  <h2 id="privacy-heading" class="section-heading">Privacy & Data</h2>

  <div class="privacy-actions">
    <div class="privacy-item">
      <div class="privacy-item-info">
        <h3>Export data</h3>
        <p>Download all your habits, tasks, and settings.</p>
      </div>
      <button
        class="btn-action"
        onclick={() => {
          exportExpanded = !exportExpanded;
        }}
        disabled={exporting}
      >
        <Download size={14} />
        {exportExpanded ? 'Hide' : 'Choose data...'}
      </button>
    </div>

    {#if exportExpanded}
      <div class="export-form">
        <div class="export-form-header">
          <button class="btn-link" onclick={toggleSelectAll}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div class="export-categories">
          {#each exportCategories as cat (cat.value)}
            <label class="export-category">
              <input
                type="checkbox"
                checked={selectedCategories.has(cat.value)}
                onchange={() => toggleCategory(cat.value)}
              />
              <span>{cat.label}</span>
            </label>
          {/each}
        </div>
        <p class="export-hint">
          Your data will be emailed to you as a password-protected ZIP. A unique password will be
          included in the email.
        </p>
        <div class="export-form-actions">
          <button
            class="btn-action btn-action--primary"
            onclick={handleExportSubmit}
            disabled={selectedCategories.size === 0 || exporting}
          >
            {exporting ? 'Requesting...' : 'Request export'}
          </button>
          <button
            class="btn-cancel"
            onclick={() => {
              exportExpanded = false;
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}

    <div class="privacy-item">
      <div class="privacy-item-info">
        <h3>Export calendar</h3>
        <p>Download your schedule as an ICS file.</p>
      </div>
      <button class="btn-action" onclick={onexportcalendar} disabled={exportingCalendar}>
        <Calendar size={14} />
        {exportingCalendar ? 'Downloading...' : 'Download .ics'}
      </button>
    </div>

    <div class="privacy-item">
      <div class="privacy-item-info">
        <h3>Active sessions</h3>
        <p>You are signed in on {sessionList.length} device(s).</p>
      </div>
      <button
        class="btn-action"
        onclick={onrevokeothersessions}
        disabled={revokingAll || sessionList.filter((s) => !s.current).length === 0}
      >
        {revokingAll ? 'Revoking...' : 'Sign out other devices'}
      </button>
    </div>

    {#if sessionList.length > 0}
      <div class="session-list">
        {#each sessionList as session (session.id)}
          <div class="session-row" class:session-row--current={session.current}>
            <div class="session-info">
              <Monitor size={14} class="session-icon" />
              <div class="session-details">
                <span class="session-agent"
                  >{session.userAgent
                    ? session.userAgent.substring(0, 60)
                    : 'Unknown device'}{session.current ? ' (current)' : ''}</span
                >
                <span class="session-meta">
                  {session.ipAddress || 'Unknown IP'}
                  &middot;
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
            {#if !session.current}
              <button
                class="btn-session-revoke"
                onclick={() => onrevokesession(session.id)}
                aria-label="Revoke session"
              >
                Revoke
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <div class="privacy-item">
      <div class="privacy-item-info">
        <h3>Privacy policy</h3>
        <p>Learn how Fluxure handles your data.</p>
      </div>
      <a href={resolve('/privacy')} class="btn-action privacy-link">
        <Shield size={14} />
        View
      </a>
    </div>
  </div>
</section>

<!-- Withdraw GDPR Consent -->
<hr class="section-divider" />

<section aria-labelledby="withdraw-heading" class="settings-section">
  <h2 id="withdraw-heading" class="section-heading section-heading--danger">Withdraw Consent</h2>
  <p class="text-hint danger-desc">
    Withdrawing consent will pause all scheduling, revoke Google Calendar access, and log out other
    sessions. Your data will be preserved.
  </p>
  <label class="consent-label">
    <input type="checkbox" bind:checked={confirmWithdraw} />
    I understand that scheduling will stop
  </label>
  <button
    class="btn-danger-outline"
    disabled={!confirmWithdraw || withdrawing}
    onclick={handleWithdrawConsent}
  >
    {withdrawing ? 'Withdrawing...' : 'Withdraw Consent'}
  </button>
  {#if withdrawError}<p class="alert-error">{withdrawError}</p>{/if}
</section>

<!-- Delete Account -->
<hr class="section-divider" />

<section aria-labelledby="delete-heading" class="settings-section">
  <h2 id="delete-heading" class="section-heading section-heading--danger">Delete Account</h2>
  <p class="text-hint danger-desc">
    Permanently delete your account and all associated data. This removes all habits, tasks,
    settings, and calendar events managed by Fluxure. This cannot be undone.
  </p>

  {#if confirmingDelete}
    <div class="danger-confirm">
      <div class="form-field">
        <label for="delete-confirm-email">Type your email to confirm</label>
        <input
          id="delete-confirm-email"
          type="email"
          placeholder={userEmail}
          bind:value={deleteConfirmEmail}
          autocomplete="off"
        />
      </div>
      {#if userHasPassword}
        <div class="form-field">
          <label for="delete-confirm-pw">Enter your password</label>
          <input
            id="delete-confirm-pw"
            type="password"
            placeholder="Password"
            bind:value={deletePassword}
            autocomplete="current-password"
          />
        </div>
      {/if}
      <div class="danger-confirm-actions">
        <button
          class="btn-danger btn-danger--filled"
          onclick={handleDeleteAccount}
          disabled={deleting || deleteConfirmEmail !== userEmail}
        >
          <Trash2 size={14} />
          {deleting ? 'Deleting...' : 'Permanently delete account'}
        </button>
        <button
          class="btn-cancel"
          onclick={() => {
            confirmingDelete = false;
            deleteConfirmEmail = '';
            deletePassword = '';
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  {:else}
    <button
      class="btn-danger-outline"
      onclick={() => {
        confirmingDelete = true;
      }}
    >
      Delete my account
    </button>
  {/if}
</section>

<!-- Danger Zone -->
{#if googleConnected}
  <hr class="section-divider" />

  <section aria-labelledby="danger-heading" class="settings-section">
    <h2 id="danger-heading" class="section-heading section-heading--danger">Danger Zone</h2>
    <p class="text-hint danger-desc">
      Delete all Fluxure-managed events from your Google Calendar. This removes every event the app
      created but does not affect your regular calendar events.
    </p>
    {#if confirmingDanger}
      <div class="danger-confirm">
        <p class="danger-confirm-text">
          This will permanently delete all Fluxure-managed events from your Google Calendar. This
          cannot be undone.
        </p>
        <div class="form-field">
          <label for="danger-confirm-input">Type <strong>DELETE</strong> to confirm</label>
          <input
            id="danger-confirm-input"
            type="text"
            placeholder="DELETE"
            bind:value={dangerConfirmText}
            autocomplete="off"
          />
        </div>
        <div class="danger-confirm-actions">
          <button
            class="btn-danger btn-danger--filled"
            onclick={handleDangerClick}
            disabled={nuking || dangerConfirmText !== 'DELETE'}
          >
            {nuking ? 'Deleting...' : 'Permanently delete all events'}
          </button>
          <button class="btn-cancel" onclick={cancelDanger} disabled={nuking}> Cancel </button>
        </div>
      </div>
    {:else}
      <button class="btn-danger-outline" onclick={handleDangerClick}>
        Delete All Managed Events
      </button>
    {/if}
  </section>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  /* Account section */
  .account-info {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .account-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--color-accent-muted);
    color: var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 600;
    flex-shrink: 0;
    overflow: hidden;
  }

  .account-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .account-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .account-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .account-email {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  /* Privacy section */
  .privacy-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .privacy-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .privacy-item-info {
    h3 {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text);
      margin: 0 0 2px;
    }

    p {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      margin: 0;
    }
  }

  .privacy-link {
    text-decoration: none;
    color: var(--color-text);
  }

  /* Session list */
  .session-list {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8125rem;

    &:last-child {
      border-bottom: none;
    }

    &--current {
      background: var(--color-accent-muted);
    }
  }

  .session-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);

    :global(.session-icon) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
    }
  }

  .session-details {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .session-agent {
    color: var(--color-text);
    font-weight: 500;
  }

  .session-meta {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .btn-session-revoke {
    padding: var(--space-1) var(--space-3);
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;

    &:hover {
      border-color: var(--color-danger);
      color: var(--color-danger);
    }
  }

  /* Export form */
  .export-form {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    @include flex-col(var(--space-3));
  }

  .export-form-header {
    display: flex;
    justify-content: flex-end;
  }

  .btn-link {
    background: none;
    border: none;
    color: var(--color-accent);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0;

    &:hover {
      text-decoration: underline;
    }
  }

  .export-categories {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-4);
  }

  .export-category {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);
    cursor: pointer;

    input[type='checkbox'] {
      accent-color: var(--color-accent);
    }
  }

  .export-hint {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    margin: 0;
  }

  .export-form-actions {
    display: flex;
    gap: var(--space-3);
  }

  .btn-action--primary {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);

    &:hover:not(:disabled) {
      background: var(--color-accent-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  /* Danger zone */
  .danger-desc {
    margin-bottom: var(--space-4);
  }

  .btn-danger-outline {
    padding: var(--space-2) var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-danger);
    background: transparent;
    color: var(--color-danger);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);

    &:hover {
      background: var(--color-danger);
      color: var(--color-accent-text);
    }
  }

  .btn-danger--filled {
    background: var(--color-danger);
    color: var(--color-accent-text);
    border: none;

    &:hover:not(:disabled) {
      background: var(--color-danger);
      opacity: 0.9;
    }
  }

  .danger-confirm {
    @include flex-col(var(--space-3));
  }

  .danger-confirm-text {
    font-size: 0.8125rem;
    color: var(--color-danger);
    font-weight: 500;
    margin: 0;
  }

  .danger-confirm-actions {
    display: flex;
    gap: var(--space-3);
  }

  /* Change password form */
  .change-password-form {
    @include flex-col(var(--space-3));
    max-width: 360px;
  }

  /* Consent withdrawal */
  .consent-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text);
    cursor: pointer;
    margin-bottom: var(--space-3);

    input[type='checkbox'] {
      accent-color: var(--color-danger);
    }
  }

  /* Alert messages */
  .alert-error {
    font-size: 0.8125rem;
    color: var(--color-danger);
    margin: var(--space-1) 0 0 0;
  }

  .alert-success {
    font-size: 0.8125rem;
    color: var(--color-success);
    margin: var(--space-1) 0 0 0;
  }
</style>
