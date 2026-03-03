import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { PUBLIC_API_URL } from '$env/static/public';
import { DEFAULT_API_BASE } from '@fluxure/shared';
import { auth as authApi } from '$lib/api';

export function isValidGoogleOAuthUrl(url: string): boolean {
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive URL parsing utility
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'accounts.google.com' || parsed.hostname.endsWith('.google.com'))
    );
  } catch {
    return false;
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const authState = $state<AuthState>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
});

function setAuth(user: User | null) {
  authState.user = user;
  authState.isAuthenticated = !!user;
  authState.isLoading = false;
}

export function getAuthState(): AuthState {
  return authState;
}

const AUTH_CHECK_TIMEOUT_MS = 5000;

export async function checkAuth(): Promise<User | null> {
  if (!browser) return null;
  try {
    authState.isLoading = true;
    const result = await Promise.race([
      authApi.me(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Auth check timed out')), AUTH_CHECK_TIMEOUT_MS),
      ),
    ]);
    const { id, name, email, avatarUrl, emailVerified, onboardingCompleted } = result.user;
    const sanitized: User = {
      id,
      name,
      email,
      emailVerified,
      onboardingCompleted,
      avatarUrl: avatarUrl?.startsWith('https://') ? avatarUrl : undefined,
    };
    setAuth(sanitized);
    return sanitized;
  } catch {
    setAuth(null);
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const result = await authApi.login(email, password);
  const user = result.user as User;
  const sanitized: User = {
    ...user,
    avatarUrl: user.avatarUrl?.startsWith('https://') ? user.avatarUrl : undefined,
  };
  setAuth(sanitized);
  return sanitized;
}

export async function signup(
  name: string,
  email: string,
  password: string,
  gdprConsent = true,
): Promise<{ user: User; requiresVerification: boolean }> {
  const result = await authApi.signup(name, email, password, gdprConsent);
  const user = result.user as User;
  const sanitized: User = {
    ...user,
    avatarUrl: user.avatarUrl?.startsWith('https://') ? user.avatarUrl : undefined,
  };
  setAuth(sanitized);
  return { ...result, user: sanitized } as { user: User; requiresVerification: boolean };
}

export async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    // Clear local state even if server call fails
  }
  setAuth(null);
  if (browser) {
    await goto('/login');
  }
}

// Calls /auth/refresh then /auth/me — two round trips required because
// the refresh endpoint returns only a success flag, not the user object.
export async function refreshToken(): Promise<boolean> {
  try {
    await authApi.refresh();
    await checkAuth();
    return true;
  } catch {
    setAuth(null);
    return false;
  }
}

export async function googleAuth(prompt?: 'select_account' | 'consent'): Promise<void> {
  if (browser) {
    const API_BASE = PUBLIC_API_URL || DEFAULT_API_BASE;
    const params = prompt ? `?prompt=${prompt}` : '';
    const res = await fetch(`${API_BASE}/auth/google${params}`, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('Too many requests. Please try again in a few minutes.');
      } else if (res.status >= 500) {
        throw new Error('Server error. Please try again later.');
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to connect Google account.');
      }
    }
    const { redirectUrl } = await res.json();
    if (!redirectUrl || !isValidGoogleOAuthUrl(redirectUrl)) {
      throw new Error('Invalid OAuth redirect URL');
    }
    window.location.href = redirectUrl;
  }
}

export async function verifyEmail(token: string): Promise<void> {
  await authApi.verifyEmail(token);
}

export async function resendVerification(email: string): Promise<void> {
  await authApi.resendVerification(email);
}

export async function forgotPassword(email: string): Promise<void> {
  await authApi.forgotPassword(email);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await authApi.resetPassword(token, password);
}
