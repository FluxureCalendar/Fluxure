<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { forgotPassword } from '$lib/auth.svelte';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import Mail from 'lucide-svelte/icons/mail';
  import Loader from 'lucide-svelte/icons/loader';

  // Email/password auth disabled — redirect to login (Google OAuth only)
  onMount(() => {
    goto(resolve('/login'), { replaceState: true });
  });

  let email = $state('');
  let submitting = $state(false);
  let sent = $state(false);
  let formError = $state('');

  async function handleForgotPassword(e: SubmitEvent) {
    e.preventDefault();
    formError = '';

    if (!email.trim()) {
      formError = 'Email is required.';
      return;
    }

    submitting = true;
    try {
      await forgotPassword(email.trim());
      sent = true;
    } catch {
      // Always show success to prevent email enumeration
      sent = true;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Forgot password')}</title>
</svelte:head>

<!-- Email/password auth disabled — preserved for re-enablement -->
{#if false}
  <AuthLayout>
    <h1 class="auth-title">Reset your password</h1>
    <p class="auth-subtitle">Enter your email and we'll send you a reset link.</p>

    {#if sent}
      <div class="verify-content">
        <div class="verify-icon-wrap">
          <div class="verify-circle"><Mail size={28} /></div>
          <div class="verify-ring"></div>
        </div>
        <p class="auth-subtitle">
          Check <strong class="verify-email">{email}</strong> for a reset link.
        </p>
        <a href={resolve('/login')} class="auth-link">Back to sign in</a>
      </div>
    {:else}
      <form class="auth-form" onsubmit={handleForgotPassword}>
        <div class="auth-field">
          <label for="forgot-email">Email address</label>
          <div class="auth-input-wrap">
            <Mail size={18} class="auth-input-icon" />
            <input
              id="forgot-email"
              type="email"
              placeholder="you@example.com"
              bind:value={email}
              required
              autocomplete="email"
            />
          </div>
        </div>

        {#if formError}
          <div class="alert-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="auth-btn-primary" disabled={submitting}>
          {#if submitting}
            <Loader size={16} class="spin" />
            Sending...
          {:else}
            Send reset link
          {/if}
        </button>
      </form>

      <p class="auth-switch">
        <a href={resolve('/login')} class="auth-link">Back to sign in</a>
      </p>
    {/if}
  </AuthLayout>
{/if}
