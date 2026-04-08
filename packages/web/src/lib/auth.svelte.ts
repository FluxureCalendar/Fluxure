import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { PUBLIC_API_URL } from '$env/static/public';
import { DEFAULT_API_BASE } from '@fluxure/shared';
import { auth as authApi } from '$lib/api';

export function isValidGoogleOAuthUrl(url: string): boolean {
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive URL parsing utility
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

export function isValidStripeUrl(url: string): boolean {
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive URL parsing utility
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'checkout.stripe.com' || parsed.hostname === 'billing.stripe.com')
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
  hasPassword: boolean;
  plan: string;
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
const AVATAR_CACHE_KEY = 'fluxure-avatar-cache';
const AVATAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AvatarCache {
  userId: string;
  dataUrl: string;
  cachedAt: number;
}

function getCachedAvatar(userId: string): string | undefined {
  if (!browser) return undefined;
  try {
    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
    if (!raw) return undefined;
    const cache: AvatarCache = JSON.parse(raw);
    if (cache.userId !== userId) return undefined;
    if (Date.now() - cache.cachedAt > AVATAR_CACHE_TTL_MS) return undefined;
    return cache.dataUrl;
  } catch {
    return undefined;
  }
}

function setCachedAvatar(userId: string, dataUrl: string): void {
  if (!browser) return;
  try {
    const cache: AvatarCache = { userId, dataUrl, cachedAt: Date.now() };
    localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable
  }
}

function clearCachedAvatar(): void {
  if (!browser) return;
  try {
    localStorage.removeItem(AVATAR_CACHE_KEY);
  } catch {
    // silent
  }
}

const MAX_AVATAR_BYTES = 512 * 1024; // 512KB

/** Fetch a remote image and convert to a data URL for local caching */
async function fetchAvatarAsDataUrl(url: string): Promise<string | undefined> {
  if (!browser) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (blob.size > MAX_AVATAR_BYTES) return undefined;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function resolveAvatarUrl(
  userId: string,
  apiAvatarUrl: string | null | undefined,
): string | undefined {
  // Check cache first — returns a data URL (no network request)
  const cached = getCachedAvatar(userId);
  if (cached) return cached;

  const sanitized = apiAvatarUrl?.startsWith('https://') ? apiAvatarUrl : undefined;
  if (sanitized) {
    // Fetch in background and cache as data URL for future loads
    fetchAvatarAsDataUrl(sanitized).then((dataUrl) => {
      if (dataUrl) {
        setCachedAvatar(userId, dataUrl);
        // Update the auth state with the data URL so the UI refreshes
        if (authState.user && authState.user.id === userId) {
          authState.user = { ...authState.user, avatarUrl: dataUrl };
        }
      }
    });
    // Return the remote URL for now (first load only)
    return sanitized;
  }

  return undefined;
}

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
    const { id, name, email, avatarUrl, emailVerified, hasPassword, plan, onboardingCompleted } =
      result.user;
    const sanitized: User = {
      id,
      name,
      email,
      emailVerified,
      hasPassword,
      plan: plan ?? 'free',
      onboardingCompleted,
      avatarUrl: resolveAvatarUrl(id, avatarUrl),
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
    hasPassword: user.hasPassword ?? true,
    plan: user.plan ?? 'free',
    avatarUrl: resolveAvatarUrl(user.id, user.avatarUrl),
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
    hasPassword: user.hasPassword ?? true,
    plan: user.plan ?? 'free',
    avatarUrl: resolveAvatarUrl(user.id, user.avatarUrl),
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
  clearCachedAvatar();

  // Tell the service worker to stop caching and clear its caches before navigating
  if (browser && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'LOGOUT' });
  }
  if (browser && 'caches' in window) {
    await caches
      .keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .catch(() => {});
  }
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

export async function googleAuth(
  prompt?: 'select_account' | 'consent',
  intent?: 'login' | 'signup',
): Promise<void> {
  if (browser) {
    const API_BASE = PUBLIC_API_URL || DEFAULT_API_BASE;
    const parts: string[] = [];
    if (prompt) parts.push(`prompt=${encodeURIComponent(prompt)}`);
    if (intent) parts.push(`intent=${encodeURIComponent(intent)}`);
    const qs = parts.join('&');
    const params = qs ? `?${qs}` : '';
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
