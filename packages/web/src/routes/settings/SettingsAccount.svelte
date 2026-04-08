<script lang="ts">
  import { getAuthState } from '$lib/auth.svelte';
  import { auth } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import { getPasswordStrength } from '$lib/utils/password';
  import { PASSWORD_MIN_LENGTH } from '@fluxure/shared';

  const authState = getAuthState();

  let currentPassword = $state('');
  let newPassword = $state('');
  let changingPassword = $state(false);

  const isOAuthOnly = $derived(!authState.user?.hasPassword);
  const passwordStrength = $derived(newPassword ? getPasswordStrength(newPassword) : null);
  const passwordTooShort = $derived(
    newPassword.length > 0 && newPassword.length < PASSWORD_MIN_LENGTH,
  );
  const canSubmit = $derived(
    currentPassword.length > 0 && newPassword.length >= PASSWORD_MIN_LENGTH && !changingPassword,
  );

  async function changePassword() {
    if (!canSubmit) return;
    changingPassword = true;
    try {
      await auth.changePassword(currentPassword, newPassword);
      showToast('Password changed', 'success');
      currentPassword = '';
      newPassword = '';
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast(err.message || 'Failed to change password', 'error');
      }
    } finally {
      changingPassword = false;
    }
  }
</script>

<section class="settings-section">
  <h3>Account</h3>

  <div class="setting-block" data-setting-id="account-email">
    <div class="setting-info">
      <span class="form-label">Name</span>
      <span class="setting-value">{authState.user?.name ?? ''}</span>
    </div>
    <div class="setting-info">
      <span class="form-label">Email</span>
      <span class="setting-value">{authState.user?.email ?? ''}</span>
    </div>
  </div>

  {#if isOAuthOnly}
    <div class="setting-block" data-setting-id="account-password">
      <h4>Password</h4>
      <p class="oauth-note">
        Your account is managed by Google. Password changes must be done through your Google
        account.
      </p>
    </div>
  {:else}
    <div class="setting-block" data-setting-id="account-password">
      <h4>Change password</h4>
      <div class="form-field">
        <label class="form-label" for="current-pw">Current password</label>
        <input id="current-pw" class="form-input" type="password" bind:value={currentPassword} />
      </div>
      <div class="form-field">
        <label class="form-label" for="new-pw">New password</label>
        <input id="new-pw" class="form-input" type="password" bind:value={newPassword} />
        {#if passwordTooShort}
          <span class="pw-hint pw-hint--error">Minimum {PASSWORD_MIN_LENGTH} characters</span>
        {:else if passwordStrength}
          <span class="pw-hint pw-hint--{passwordStrength}">{passwordStrength}</span>
        {/if}
      </div>
      <button class="btn-primary" onclick={changePassword} disabled={!canSubmit}>
        {changingPassword ? 'Changing...' : 'Change password'}
      </button>
    </div>
  {/if}
</section>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-section {
    @include flex-col(var(--space-4));
  }

  .setting-block {
    @include flex-col(var(--space-3));
  }

  .setting-info {
    @include flex-col(var(--space-1));
  }

  .setting-value {
    font-size: 0.875rem;
    color: var(--color-text);
  }

  .oauth-note {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    line-height: 1.5;
  }

  h4 {
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
  }

  .pw-hint {
    font-size: 0.75rem;
    font-weight: 500;
    &--error {
      color: var(--color-danger);
    }
    &--weak {
      color: var(--color-danger);
    }
    &--fair {
      color: var(--color-warning);
    }
    &--strong {
      color: var(--color-success);
    }
  }
</style>
