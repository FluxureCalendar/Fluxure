<script lang="ts">
  import { pageTitle, APP_NAME } from '$lib/brand';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { googleAuth } from '$lib/auth.svelte';
  import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
  import GoogleLogo from '$lib/components/auth/GoogleLogo.svelte';
  import Loader from 'lucide-svelte/icons/loader';

  const oauthErrors: Record<string, string> = {
    oauth_failed: 'Google sign-in failed. Please try again.',
    missing_code: 'Google sign-in was cancelled or failed.',
    auth_failed: 'Authentication failed. Please try again.',
    invalid_state: 'Google sign-in expired. Please try again.',
    state_expired: 'Google sign-in expired. Please try again.',
    no_email: 'Could not retrieve email from Google account.',
  };

  let googleLoading = $state(false);
  let loginError = $state(oauthErrors[page.url.searchParams.get('error') ?? ''] ?? '');

  // If redirected back because prompt=none failed, retry with account picker
  // If redirected back because refresh token is missing, retry with consent
  onMount(() => {
    if (page.url.searchParams.get('google_consent') === '1') {
      googleAuth('consent');
    } else if (page.url.searchParams.get('google_retry') === '1') {
      googleAuth('select_account');
    }
  });

  async function handleGoogleSignIn() {
    if (googleLoading) return;
    googleLoading = true;
    loginError = '';
    try {
      await googleAuth();
    } catch {
      googleLoading = false;
      loginError = 'Failed to start Google sign-in. Please try again.';
    }
  }
</script>

<svelte:head>
  <title>{pageTitle('Sign in')}</title>
</svelte:head>

<AuthLayout>
  <h1 class="auth-title">Welcome back</h1>
  <p class="auth-subtitle">Sign in to your {APP_NAME} account.</p>

  {#if loginError}
    <div class="alert-error" role="alert">{loginError}</div>
  {/if}

  <button
    class="auth-btn-social"
    onclick={handleGoogleSignIn}
    type="button"
    disabled={googleLoading}
  >
    {#if googleLoading}
      <Loader size={18} class="spin" />
      Redirecting to Google...
    {:else}
      <GoogleLogo />
      Continue with Google
    {/if}
  </button>

  <p class="auth-privacy">
    By signing in, you agree to our <a
      href={resolve('/privacy')}
      class="auth-link"
      target="_blank"
      rel="noopener noreferrer">Privacy Policy</a
    >.
  </p>
</AuthLayout>
