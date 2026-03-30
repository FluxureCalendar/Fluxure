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
  let oauthParamsHandled = $state(false);

  const authState = getAuthState();

  // Handle OAuth error params from URL (runs once on mount)
  $effect(() => {
    if (oauthParamsHandled) return;
    const params = $page.url.searchParams;
    const oauthError = params.get('error');
    const googleConsent = params.get('google_consent');
    const googleRetry = params.get('google_retry');

    // Only process if there are relevant params
    if (!oauthError && !googleConsent && !googleRetry) return;

    oauthParamsHandled = true;

    if (oauthError === 'oauth_failed') {
      error = 'Google sign-in failed. Please try again.';
    } else if (oauthError === 'missing_code') {
      error = 'Authorization was incomplete. Please try again.';
    }

    // Handle google_consent and google_retry — clear params first to prevent
    // redirect loops if OAuth fails and returns back to /login with same params
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
      await googleAuth(prompt);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Google sign-in failed.';
      googleLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Sign In')}</title>
</svelte:head>

<AuthLayout>
  <h2 class="auth-title">Welcome back</h2>
  <p class="auth-subtitle">Sign in to your Fluxure account</p>

  {#if error}
    <div class="auth-error">{error}</div>
  {/if}

  <button class="auth-social-btn" onclick={() => handleGoogleAuth()} disabled={googleLoading}>
    <GoogleLogo />
    {googleLoading ? 'Redirecting...' : 'Continue with Google'}
  </button>

  <p class="auth-footer">
    Don't have an account? <a href="/signup">Sign up</a>
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
