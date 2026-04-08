<script lang="ts">
  import { page } from '$app/stores';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import { verifyEmail, resendVerification } from '$lib/auth.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { pageTitle } from '$lib/brand';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import Mail from 'lucide-svelte/icons/mail';

  let status = $state<'verifying' | 'success' | 'error' | 'pending'>('pending');
  let errorMessage = $state('');
  let resendEmail = $state('');
  let resendLoading = $state(false);
  let resendSent = $state(false);

  // Auto-verify if token in URL — use a guard to prevent duplicate calls
  // when the $effect re-runs due to $page reactivity changes.
  let verifiedToken = '';
  $effect(() => {
    const token = $page.url.searchParams.get('token');
    if (token && token !== verifiedToken) {
      verifiedToken = token;
      handleVerify(token);
    }
  });

  async function handleVerify(token: string) {
    status = 'verifying';

    try {
      await verifyEmail(token);
      status = 'success';
    } catch (err) {
      status = 'error';
      errorMessage = err instanceof Error ? err.message : 'Verification failed.';
    }
  }

  async function handleResend() {
    if (!resendEmail) return;
    resendLoading = true;

    try {
      await resendVerification(resendEmail);
      resendSent = true;
      showToast('Verification email sent', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resend email', 'error');
    } finally {
      resendLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Verify Email')}</title>
</svelte:head>

<AuthLayout>
  {#if status === 'verifying'}
    <div class="auth-message">
      <div class="spinner"></div>
      <p>Verifying your email...</p>
    </div>
  {:else if status === 'success'}
    <div class="auth-message">
      <CheckCircle size={40} class="icon-success" />
      <h2 class="auth-title">Email verified</h2>
      <p>Your email has been verified successfully.</p>
      <a href="/login" class="btn-primary continue-btn">Continue to sign in</a>
    </div>
  {:else if status === 'error'}
    <div class="auth-message">
      <AlertCircle size={40} class="icon-error" />
      <h2 class="auth-title">Verification failed</h2>
      <p>{errorMessage}</p>
      <p class="hint">The link may have expired. Request a new verification email below.</p>
    </div>

    <form
      class="resend-form"
      onsubmit={(e) => {
        e.preventDefault();
        handleResend();
      }}
    >
      <div class="form-field">
        <label class="form-label" for="resend-email">Email address</label>
        <input
          id="resend-email"
          class="form-input"
          type="email"
          bind:value={resendEmail}
          placeholder="you@example.com"
          required
        />
      </div>
      <button class="btn-secondary resend-btn" type="submit" disabled={resendLoading || resendSent}>
        {resendSent ? 'Email sent' : resendLoading ? 'Sending...' : 'Resend verification email'}
      </button>
    </form>

    <div class="auth-links">
      <a href="/login">Back to sign in</a>
    </div>
  {:else}
    <div class="auth-message">
      <Mail size={40} class="icon-accent" />
      <h2 class="auth-title">Check your email</h2>
      <p>
        We sent a verification link to your email address. Click the link to verify your account.
      </p>
    </div>

    <form
      class="resend-form"
      onsubmit={(e) => {
        e.preventDefault();
        handleResend();
      }}
    >
      <p class="resend-hint">Didn't receive the email?</p>
      <div class="form-field">
        <input
          class="form-input"
          type="email"
          bind:value={resendEmail}
          placeholder="Enter your email to resend"
          required
        />
      </div>
      <button class="btn-secondary resend-btn" type="submit" disabled={resendLoading || resendSent}>
        {resendSent ? 'Email sent' : resendLoading ? 'Sending...' : 'Resend verification email'}
      </button>
    </form>

    <div class="auth-links">
      <a href="/login">Back to sign in</a>
    </div>
  {/if}
</AuthLayout>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  :global(.icon-success) {
    color: var(--color-success);
  }

  :global(.icon-error) {
    color: var(--color-danger);
  }

  :global(.icon-accent) {
    color: var(--color-accent);
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

  .hint {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  .continue-btn {
    text-decoration: none;
    padding: var(--space-2) var(--space-6);
  }

  .resend-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .resend-hint {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .resend-btn {
    width: 100%;
  }
</style>
