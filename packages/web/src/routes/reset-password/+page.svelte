<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { resetPassword } from '$lib/auth.svelte';
  import { getPasswordStrength } from '$lib/utils/password';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import Lock from 'lucide-svelte/icons/lock';
  import Eye from 'lucide-svelte/icons/eye';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import Loader from 'lucide-svelte/icons/loader';

  // Email/password auth disabled — redirect to login (Google OAuth only)
  onMount(() => {
    goto(resolve('/login'), { replaceState: true });
  });

  // State preserved for re-enablement of email/password auth
  let token = $derived(page.url.searchParams.get('token') ?? '');
  let password = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let submitting = $state(false);
  let formError = $state('');
  let tokenError = $state('');
  let success = $state(false);
  let redirectTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    return () => {
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  });

  let strength = $derived(password ? getPasswordStrength(password) : 'weak');
  let strengthPercent = $derived(
    !password ? 0 : strength === 'weak' ? 33 : strength === 'fair' ? 66 : 100,
  );
  let mismatch = $derived(confirmPassword.length > 0 && password !== confirmPassword);

  async function handleResetPassword(e: SubmitEvent) {
    e.preventDefault();
    formError = '';

    if (!token) {
      formError = 'Invalid or expired reset link.';
      return;
    }
    if (password.length < 8) {
      formError = 'Password must be at least 8 characters.';
      return;
    }
    if (password !== confirmPassword) {
      formError = 'Passwords do not match.';
      return;
    }

    submitting = true;
    try {
      await resetPassword(token, password);
      success = true;
      redirectTimer = setTimeout(() => goto(resolve('/login')), 2000);
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Password reset failed. Please try again.';
    } finally {
      submitting = false;
    }
  }

  function togglePw() {
    showPassword = !showPassword;
  }
</script>

<svelte:head>
  <title>{pageTitle('Reset password')}</title>
</svelte:head>

<!-- Email/password auth disabled — preserved for re-enablement -->
{#if false}
  <AuthLayout>
    {#if success}
      <div class="verify-content">
        <h1 class="auth-title">Password updated!</h1>
        <p class="auth-subtitle">Redirecting to sign in...</p>
      </div>
    {:else if tokenError}
      <div class="verify-content">
        <h1 class="auth-title">Invalid reset link</h1>
        <p class="auth-subtitle">{tokenError}</p>
        <div class="verify-actions">
          <a href={resolve('/forgot-password')} class="auth-btn-primary">Request new reset link</a>
          <a href={resolve('/login')} class="auth-link">Back to sign in</a>
        </div>
      </div>
    {:else}
      <h1 class="auth-title">Set a new password</h1>
      <p class="auth-subtitle">Choose a strong password for your account.</p>

      <form class="auth-form" onsubmit={handleResetPassword}>
        <div class="auth-field">
          <label for="reset-pw">New password</label>
          <div class="auth-input-wrap">
            <Lock size={18} class="auth-input-icon" />
            <input
              id="reset-pw"
              type={showPassword ? 'text' : 'password'}
              placeholder="Min. 8 characters"
              bind:value={password}
              required
              minlength={8}
              autocomplete="new-password"
            />
            <button
              type="button"
              class="auth-toggle-pw"
              onclick={togglePw}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {#if showPassword}
                <EyeOff size={16} />
              {:else}
                <Eye size={16} />
              {/if}
            </button>
          </div>
          {#if password}
            <div class="password-strength">
              <div
                class="password-strength-bar"
                style:width="{strengthPercent}%"
                class:weak={strength === 'weak'}
                class:fair={strength === 'fair'}
                class:strong={strength === 'strong'}
              ></div>
            </div>
            <span class="sr-only" aria-live="polite">Password strength: {strength}</span>
          {/if}
        </div>

        <div class="auth-field">
          <label for="reset-pw-confirm">Confirm password</label>
          <div class="auth-input-wrap" class:has-error={mismatch}>
            <Lock size={18} class="auth-input-icon" />
            <input
              id="reset-pw-confirm"
              type={showPassword ? 'text' : 'password'}
              placeholder="Repeat password"
              bind:value={confirmPassword}
              required
              autocomplete="new-password"
            />
          </div>
          {#if mismatch}
            <span class="auth-field-error" role="alert">Passwords do not match.</span>
          {/if}
        </div>

        {#if formError}
          <div class="alert-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="auth-btn-primary" disabled={submitting || mismatch}>
          {#if submitting}
            <Loader size={16} class="spin" />
            Updating...
          {:else}
            Update password
          {/if}
        </button>
      </form>
    {/if}
  </AuthLayout>
{/if}
