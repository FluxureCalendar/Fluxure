<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { verifyEmail, resendVerification } from '$lib/auth.svelte';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import Mail from 'lucide-svelte/icons/mail';
  import Check from 'lucide-svelte/icons/check';

  let email = $derived(page.url.searchParams.get('email') ?? '');
  let token = $derived(page.url.searchParams.get('token') ?? '');
  let manualEmail = $state('');
  let verifying = $state(false);
  let verified = $state(false);
  let verifyError = $state('');
  let resendCooldown = $state(0);
  let resendTimer: ReturnType<typeof setInterval> | undefined;
  let redirectTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    // Email/password auth disabled — redirect to login (Google OAuth only)
    if (!token) {
      goto(resolve('/login'), { replaceState: true });
      return;
    }
    // Still allow token verification for users who received emails before disable
    handleVerify();
    return () => {
      if (resendTimer) clearInterval(resendTimer);
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  });

  async function handleVerify() {
    verifying = true;
    verifyError = '';
    try {
      await verifyEmail(token);
      verified = true;
      redirectTimer = setTimeout(() => goto(resolve('/onboarding')), 2000);
    } catch (err) {
      verifyError = err instanceof Error ? err.message : 'Verification failed.';
    } finally {
      verifying = false;
    }
  }

  let resendTarget = $derived(email || manualEmail);

  async function resendEmail() {
    if (resendCooldown > 0 || !resendTarget) return;
    try {
      await resendVerification(resendTarget);
      resendCooldown = 60;
      resendTimer = setInterval(() => {
        resendCooldown -= 1;
        if (resendCooldown <= 0 && resendTimer) {
          clearInterval(resendTimer);
          resendTimer = undefined;
        }
      }, 1000);
    } catch (err) {
      verifyError = err instanceof Error ? err.message : 'Failed to resend verification email.';
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Verify email')}</title>
</svelte:head>

<AuthLayout>
  {#if verified}
    <div class="verify-content">
      <div class="verify-icon-wrap">
        <div class="verify-circle">
          <Check size={28} />
        </div>
      </div>
      <h1 class="auth-title">Email verified!</h1>
      <p class="auth-subtitle">Redirecting you to get started...</p>
    </div>
  {:else if verifying}
    <div class="verify-content">
      <h1 class="auth-title">Verifying your email...</h1>
      <p class="auth-subtitle">Please wait a moment.</p>
    </div>
  {:else if verifyError}
    <div class="verify-content">
      <h1 class="auth-title">Verification failed</h1>
      <p class="auth-subtitle">{verifyError}</p>
      <div class="verify-actions">
        <a href={resolve('/login')} class="auth-link">Back to sign in</a>
      </div>
    </div>
  {:else}
    <div class="verify-content">
      <div class="verify-icon-wrap">
        <div class="verify-circle">
          <Mail size={28} />
        </div>
        <div class="verify-ring"></div>
      </div>

      <h1 class="auth-title">Check your email</h1>
      <p class="auth-subtitle">
        We sent a verification link to<br />
        {#if email}
          <strong class="verify-email">{email}</strong>
        {:else}
          <strong class="verify-email">your email address</strong>
        {/if}
      </p>

      <div class="verify-instructions">
        <p>Click the link in the email to verify your account.</p>
        <p class="verify-spam">Don't see it? Check your spam folder.</p>
      </div>

      {#if !email}
        <div class="auth-field">
          <label for="manual-email">Enter your email to resend the verification link:</label>
          <div class="auth-input-wrap">
            <Mail size={18} class="auth-input-icon" />
            <input
              id="manual-email"
              type="email"
              placeholder="your@email.com"
              bind:value={manualEmail}
              autocomplete="email"
            />
          </div>
        </div>
      {/if}

      <div class="verify-actions">
        <button
          class="auth-btn-primary"
          onclick={resendEmail}
          disabled={resendCooldown > 0 || !resendTarget}
        >
          {#if resendCooldown > 0}
            Resend in {resendCooldown}s
          {:else}
            Resend verification email
          {/if}
        </button>
        <a href={resolve('/login')} class="auth-link">Back to sign in</a>
      </div>
    </div>
  {/if}
</AuthLayout>
