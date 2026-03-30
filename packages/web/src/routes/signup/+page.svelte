<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import { googleAuth, getAuthState } from '$lib/auth.svelte';
  import { pageTitle } from '$lib/brand';
  import { BRAND } from '@fluxure/shared';

  let googleLoading = $state(false);
  let error = $state('');
  let gdprConsent = $state(false);

  const authState = getAuthState();

  // Handle OAuth error params from URL
  $effect(() => {
    const params = $page.url.searchParams;
    const oauthError = params.get('error');

    if (oauthError === 'oauth_failed') {
      error = 'Google sign-up failed. Please try again.';
    } else if (oauthError === 'missing_code') {
      error = 'Authorization was incomplete. Please try again.';
    } else if (oauthError === 'no_account') {
      error = 'No account found. Sign up below to get started.';
    }

    const googleConsent = params.get('google_consent');
    const googleRetry = params.get('google_retry');

    if (googleConsent === 'required' || googleRetry === 'true') {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('google_consent');
      clean.searchParams.delete('google_retry');
      window.history.replaceState({}, '', clean.pathname + clean.search);
      handleGoogleAuth('consent');
    }
  });

  // Redirect if already authenticated
  $effect(() => {
    if (authState.isAuthenticated && authState.user) {
      if (!authState.user.onboardingCompleted) {
        goto('/onboarding');
      } else {
        goto('/');
      }
    }
  });

  async function handleGoogleAuth(prompt?: 'select_account' | 'consent') {
    error = '';
    googleLoading = true;

    try {
      await googleAuth(prompt, 'signup');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Google sign-up failed.';
      googleLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Sign Up')}</title>
</svelte:head>

<AuthLayout>
  <h2 class="auth-title">Create your account</h2>
  <p class="auth-subtitle">Start optimizing your schedule with Fluxure</p>

  {#if error}
    <div class="auth-error">{error}</div>
  {/if}

  <label class="auth-consent">
    <input type="checkbox" bind:checked={gdprConsent} />
    <span
      >I agree to the <a href="{BRAND.landingUrl}/privacy" target="_blank" rel="noopener noreferrer"
        >Privacy Policy</a
      > and consent to data processing as described therein.</span
    >
  </label>

  <button
    class="auth-social-btn"
    onclick={() => handleGoogleAuth()}
    disabled={googleLoading || !gdprConsent}
  >
    <GoogleLogo />
    {googleLoading ? 'Redirecting...' : 'Sign up with Google'}
  </button>

  <p class="auth-footer">
    Already have an account? <a href="/login">Sign in</a>
  </p>
</AuthLayout>

<style lang="scss">
  .auth-subtitle {
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 0.875rem;
    margin-bottom: var(--space-8);
  }

  .auth-error {
    padding: var(--space-3);
    color: var(--color-danger);
    font-size: 0.8125rem;
    line-height: 1.5;
    margin-bottom: var(--space-4);
    text-align: center;
  }

  .auth-consent {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-4);
    cursor: pointer;

    input[type='checkbox'] {
      margin-top: 2px;
      flex-shrink: 0;
      accent-color: var(--color-accent);
    }

    a {
      color: var(--color-accent);
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
  }

  .auth-footer {
    text-align: center;
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin-top: var(--space-6);

    a {
      color: var(--color-accent);
      text-decoration: none;
      font-weight: 500;
      &:hover {
        text-decoration: underline;
      }
    }
  }
</style>
