<script lang="ts">
  import '$lib/styles/main.scss';
  import { BRAND } from '@fluxure/shared';
  import { page, navigating } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { browser } from '$app/environment';
  import { onMount, untrack } from 'svelte';
  import {
    subscribe as subscribeWs,
    subscribeConnectionState,
    subscribePlanUpdates,
    disconnect as disconnectWs,
  } from '$lib/ws';
  import type { ConnectionState } from '$lib/ws';
  import Toast from '$lib/components/Toast.svelte';
  import { showError, showInfo } from '$lib/notifications.svelte';
  import SearchPalette from './SearchPalette.svelte';
  import WifiOff from 'lucide-svelte/icons/wifi-off';
  import Wifi from 'lucide-svelte/icons/wifi';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Repeat from 'lucide-svelte/icons/repeat';
  import CheckSquare from 'lucide-svelte/icons/check-square';
  import Users from 'lucide-svelte/icons/users';
  import Target from 'lucide-svelte/icons/target';
  import Link from 'lucide-svelte/icons/link';
  import BarChart3 from 'lucide-svelte/icons/bar-chart-3';
  import Search from 'lucide-svelte/icons/search';
  import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
  import Menu from 'lucide-svelte/icons/menu';
  import X from 'lucide-svelte/icons/x';
  import ProfileMenu from './ProfileMenu.svelte';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import Crown from 'lucide-svelte/icons/crown';
  import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
  import { logout, getAuthState, checkAuth, refreshToken } from '$lib/auth.svelte';
  import { billing as billingApi } from '$lib/api';
  import { invalidateSettings } from '$lib/cache.svelte';
  import type { BillingStatus } from '$lib/api';

  let { children } = $props();

  let collapsed = $state(false);
  let mobileOpen = $state(false);
  let searchOpen = $state(false);
  let isMac = $state(false);
  let profileMenuOpen = $state(false);
  let avatarFailed = $state(false);
  let profileTriggerEl: HTMLButtonElement | undefined = $state();
  let searchPaletteRef: SearchPalette | undefined = $state();

  function openSearch() {
    searchPaletteRef?.openSearch();
  }

  function closeSearch() {
    searchPaletteRef?.closeSearch();
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (searchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
    }
    if (e.key === 'Escape' && searchOpen) {
      e.preventDefault();
      closeSearch();
    }
  }

  let connectionState = $state<ConnectionState>('disconnected');
  let showRecoveryToast = $state(false);
  let recoveryToastTimer: ReturnType<typeof setTimeout> | undefined;
  let wasDisconnected = false;
  let hasConnectedOnce = false;

  let showGoogleAuthBanner = $state(false);

  let systemError = $state('');

  // Read before first render to prevent sidebar flash
  if (browser) {
    collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  }

  onMount(() => {
    document.body.classList.add('hydrated');
    isMac = navigator.userAgent?.includes('Mac') ?? false;
    if (!auth.isAuthenticated && !isPublicRoute) {
      checkAuth();
    }
  });

  let isLoginOrSignupRoute = $derived(
    page.url.pathname === '/login' || page.url.pathname === '/signup',
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !isPublicRoute) {
      goto(resolve('/login'));
    }
    if (auth.isAuthenticated && !auth.isLoading && isLoginOrSignupRoute) {
      goto(resolve('/'));
    }
    // Redirect to onboarding if not yet completed
    if (
      auth.isAuthenticated &&
      !auth.isLoading &&
      auth.user &&
      !auth.user.onboardingCompleted &&
      !isPublicRoute
    ) {
      goto(resolve('/onboarding'));
    }
  });

  $effect(() => {
    // Re-run on navigation by tracking isPublicRoute
    if (isPublicRoute) {
      disconnectWs();
      return;
    }

    const unsubGoogleAuth = subscribeWs((msg) => {
      if (msg.type === 'google_auth_required') {
        showGoogleAuthBanner = true;
      }
      if (msg.type === 'system_message') {
        const level = (msg as Record<string, unknown>).level as string;
        const message = (msg as Record<string, unknown>).message as string;
        if (level === 'error') {
          systemError = message;
        } else {
          if (level === 'warning') {
            showError(message);
          } else {
            showInfo(message);
          }
        }
      }
    });

    const unsubPlan = subscribePlanUpdates(async () => {
      try {
        await refreshToken();
        invalidateSettings();
        billingStatus = await billingApi.status();
      } catch {
        // Billing errors visible via billing status UI
      }
    });

    const unsub = subscribeConnectionState((state) => {
      // Untrack to prevent infinite effect loop from $state reads in this handler
      untrack(() => {
        const prevState = connectionState;
        connectionState = state;

        if (state === 'connected') {
          // Only show "Back online" toast after a previously established connection was lost
          if (wasDisconnected && hasConnectedOnce && prevState !== 'connected') {
            showRecoveryToast = true;
            if (recoveryToastTimer) clearTimeout(recoveryToastTimer);
            recoveryToastTimer = setTimeout(() => {
              showRecoveryToast = false;
            }, 3000);
          }
          hasConnectedOnce = true;
          wasDisconnected = false;
        } else {
          wasDisconnected = true;
          showRecoveryToast = false;
          if (recoveryToastTimer) clearTimeout(recoveryToastTimer);
        }
      });
    });
    return () => {
      unsub();
      unsubGoogleAuth();
      unsubPlan();
    };
  });

  $effect(() => {
    return () => {
      searchPaletteRef?.cleanup();
      if (recoveryToastTimer) clearTimeout(recoveryToastTimer);
    };
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
    if (browser) {
      localStorage.setItem('sidebar-collapsed', String(collapsed));
    }
  }

  function closeMobile() {
    mobileOpen = false;
  }

  function handleSidebarKeydown(e: KeyboardEvent) {
    if (!mobileOpen) return;
    if (e.key === 'Escape') {
      closeMobile();
      return;
    }
    if (e.key === 'Tab') {
      const sidebar = e.currentTarget as HTMLElement;
      const focusable = sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const mainNav = [
    { href: '/' as const, label: 'Dashboard', icon: Calendar },
    { href: '/habits' as const, label: 'Habits', icon: Repeat },
    { href: '/tasks' as const, label: 'Tasks', icon: CheckSquare },
    { href: '/meetings' as const, label: 'Meetings', icon: Users },
    { href: '/focus' as const, label: 'Focus Time', icon: Target },
  ];

  const secondaryNav = [
    { href: '/links' as const, label: 'Links', icon: Link },
    { href: '/analytics' as const, label: 'Analytics', icon: BarChart3 },
  ];

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
  }

  let isBookingRoute = $derived(page.url.pathname.startsWith('/book'));

  const AUTH_ROUTES = [
    '/login',
    '/signup',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/onboarding',
    '/privacy',
    '/terms',
    '/pricing',
  ];
  let isAuthRoute = $derived(AUTH_ROUTES.some((r) => page.url.pathname.startsWith(r)));
  let isPublicRoute = $derived(isBookingRoute || isAuthRoute);

  const auth = getAuthState();
  let billingStatus = $state<BillingStatus | null>(null);

  $effect(() => {
    if (auth.isAuthenticated && !isPublicRoute) {
      billingApi
        .status()
        .then((s) => {
          billingStatus = s;
        })
        .catch(() => {});
    }
  });

  let sidebarPlanLabel = $derived(
    !billingStatus
      ? null
      : billingStatus.isTrial
        ? `Trial — ${billingStatus.trialDaysRemaining ?? 0}d left`
        : billingStatus.plan === 'pro'
          ? 'Pro'
          : 'Free Plan',
  );
  let isTrialPlan = $derived(billingStatus?.isTrial ?? false);
  let isProPlan = $derived(billingStatus?.plan === 'pro' && !billingStatus?.isTrial);

  let userFirstName = $derived(auth.user?.name?.split(' ')[0] ?? '');
  let userInitials = $derived(
    auth.user?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? '',
  );

  function toggleProfileMenu() {
    profileMenuOpen = !profileMenuOpen;
  }

  function closeProfileMenu() {
    profileMenuOpen = false;
  }

  function handleProfileAction(action: 'settings' | 'logout') {
    closeProfileMenu();
    closeMobile();
    if (action === 'settings') {
      goto(resolve('/settings'));
    } else {
      logout();
    }
  }
</script>

<svelte:window onkeydown={isPublicRoute ? undefined : handleGlobalKeydown} />

{#if isPublicRoute}
  <!-- Public/auth pages render without app shell -->
  {@render children()}
{:else if auth.isLoading || (!auth.isAuthenticated && !auth.isLoading)}
  <div class="auth-loading"></div>
{:else}
  <a href="#main" class="skip-link">Skip to main content</a>

  <!-- Connection status banner -->
  {#if connectionState === 'capacity'}
    <div class="connection-banner capacity" role="alert" aria-live="polite">
      <WifiOff size={14} strokeWidth={1.5} />
      <span>Server at capacity — retrying shortly</span>
    </div>
  {:else if connectionState === 'disconnected' || connectionState === 'reconnecting'}
    <div class="connection-banner" role="alert" aria-live="polite">
      <WifiOff size={14} strokeWidth={1.5} />
      <span>{connectionState === 'reconnecting' ? 'Reconnecting...' : "You're offline"}</span>
    </div>
  {/if}
  {#if showRecoveryToast}
    <div class="connection-toast" role="status" aria-live="polite">
      <Wifi size={14} strokeWidth={1.5} />
      <span>Back online</span>
    </div>
  {/if}
  {#if showGoogleAuthBanner}
    <div class="connection-banner google-auth" role="alert" aria-live="polite">
      <Calendar size={14} strokeWidth={1.5} />
      <span>Google Calendar disconnected — <a href="/settings">reconnect in Settings</a></span>
      <button
        class="banner-dismiss"
        onclick={() => (showGoogleAuthBanner = false)}
        aria-label="Dismiss Google Calendar disconnected banner"
      >
        <X size={12} />
      </button>
    </div>
  {/if}

  {#if navigating.to}
    <div class="nav-progress" aria-hidden="true"></div>
  {/if}

  <SearchPalette bind:open={searchOpen} bind:this={searchPaletteRef} />

  <div class="app-layout" class:sidebar-collapsed={collapsed}>
    <!-- Mobile hamburger -->
    <button
      class="mobile-menu-btn"
      onclick={() => {
        mobileOpen = !mobileOpen;
      }}
      aria-label="Toggle menu"
      aria-expanded={mobileOpen}
    >
      {#if mobileOpen}
        <X size={20} strokeWidth={1.5} />
      {:else}
        <Menu size={20} strokeWidth={1.5} />
      {/if}
    </button>

    <!-- Mobile backdrop -->
    {#if mobileOpen}
      <button
        class="sidebar-backdrop"
        onclick={closeMobile}
        onkeydown={(e) => {
          if (e.key === 'Escape') closeMobile();
        }}
        aria-label="Close sidebar"
        tabindex="-1"
      ></button>
    {/if}

    <!-- Sidebar -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <aside
      class="sidebar"
      class:mobile-open={mobileOpen}
      aria-label="Application sidebar"
      onkeydown={handleSidebarKeydown}
    >
      <div class="sidebar-header">
        {#if collapsed}
          <button
            class="sidebar-logo sidebar-logo--btn"
            onclick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar">F</button
          >
        {:else}
          <span class="sidebar-logo">F</span>
          <span class="sidebar-brand">{BRAND.name}</span>
          <button
            class="collapse-btn"
            onclick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={16} strokeWidth={1.5} />
          </button>
        {/if}
      </div>

      <div class="sidebar-divider"></div>

      {#if !collapsed}
        <button class="nav-search" onclick={openSearch}>
          <Search size={20} strokeWidth={1.5} />
          <span>Search...</span>
          <kbd>{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
        </button>
      {/if}

      <div class="sidebar-divider"></div>

      <nav class="sidebar-nav" aria-label="Main navigation">
        {#each mainNav as item (item.href)}
          <a
            href={resolve(item.href)}
            onclick={closeMobile}
            class="nav-item"
            class:active={isActive(item.href)}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            <item.icon size={20} strokeWidth={1.5} />
            {#if !collapsed}
              <span class="nav-label">{item.label}</span>
            {/if}
          </a>
        {/each}

        <div class="sidebar-divider"></div>

        {#each secondaryNav as item (item.href)}
          <a
            href={resolve(item.href)}
            onclick={closeMobile}
            class="nav-item"
            class:active={isActive(item.href)}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            <item.icon size={20} strokeWidth={1.5} />
            {#if !collapsed}
              <span class="nav-label">{item.label}</span>
            {/if}
          </a>
        {/each}
      </nav>

      <!-- Plan indicator -->
      {#if sidebarPlanLabel}
        <div class="plan-indicator" class:plan-indicator--pro={isProPlan}>
          {#if isProPlan}
            {#if !collapsed}
              <Crown size={14} strokeWidth={1.5} />
              <span class="plan-label">{sidebarPlanLabel}</span>
            {:else}
              <Crown size={14} strokeWidth={1.5} />
            {/if}
          {:else if isTrialPlan}
            <a href="/settings#billing" class="plan-upgrade-link" onclick={closeMobile}>
              <Crown size={14} strokeWidth={1.5} />
              {#if !collapsed}
                <span class="plan-label">{sidebarPlanLabel}</span>
              {/if}
            </a>
          {:else if !collapsed}
            <span class="plan-label plan-label--free">{sidebarPlanLabel}</span>
            <a href="/settings#billing" class="upgrade-btn" onclick={closeMobile}>
              Upgrade
              <ArrowUpRight size={12} strokeWidth={2} />
            </a>
          {:else}
            <a
              href="/settings#billing"
              class="upgrade-btn upgrade-btn--icon"
              title="Upgrade to Pro"
              onclick={closeMobile}
            >
              <ArrowUpRight size={14} strokeWidth={2} />
            </a>
          {/if}
        </div>
      {/if}

      <!-- Profile -->
      <div class="profile-section">
        <button
          class="profile-trigger"
          bind:this={profileTriggerEl}
          onclick={toggleProfileMenu}
          aria-expanded={profileMenuOpen}
          aria-haspopup="menu"
          aria-label="Open profile menu"
          title={collapsed ? (auth.user?.name ?? 'Profile') : undefined}
        >
          {#if auth.user?.avatarUrl && !avatarFailed}
            <img
              class="profile-avatar"
              src={auth.user.avatarUrl}
              alt=""
              onerror={() => {
                avatarFailed = true;
              }}
              referrerpolicy="no-referrer"
            />
          {:else}
            <span class="profile-avatar profile-avatar--initials">{userInitials}</span>
          {/if}
          {#if !collapsed}
            <span class="profile-name">Hey, {userFirstName}</span>
            <ChevronUp size={14} strokeWidth={1.5} class="profile-chevron" />
          {/if}
        </button>
      </div>
    </aside>

    {#if profileMenuOpen}
      <ProfileMenu
        triggerEl={profileTriggerEl}
        onsettings={() => handleProfileAction('settings')}
        onlogout={() => handleProfileAction('logout')}
        onclose={closeProfileMenu}
      />
    {/if}

    <main id="main" class="main-content">
      {#if systemError}
        <div class="system-error-banner" role="alert">
          <span>{systemError}</span>
          <button
            class="banner-dismiss"
            onclick={() => (systemError = '')}
            aria-label="Dismiss system error">Dismiss</button
          >
        </div>
      {/if}
      {@render children()}
    </main>
  </div>
{/if}

<Toast />

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .auth-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .app-layout {
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    width: var(--sidebar-width);
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    @include flex-col;
    flex-shrink: 0;
    transition: width var(--transition-base);
    overflow: hidden;
    position: sticky;
    top: 0;
    height: 100vh;

    .sidebar-collapsed & {
      width: var(--sidebar-collapsed-width);
    }
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    height: 56px;

    .sidebar-collapsed & {
      justify-content: center;
      padding: var(--space-3);
    }
  }

  .collapse-btn {
    @include flex-center;
    margin-left: auto;
    padding: var(--space-1);
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
    flex-shrink: 0;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-secondary);
    }

    .sidebar-collapsed & {
      display: none;
    }
  }

  .sidebar-logo {
    @include flex-center;
    width: 28px;
    height: 28px;
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-radius: var(--radius-md);
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;

    &--btn {
      border: none;
      cursor: pointer;
      transition: opacity var(--transition-fast);

      &:hover {
        opacity: 0.85;
      }
    }
  }

  .sidebar-brand {
    font-weight: 600;
    font-size: 15px;
    color: var(--color-text);
    white-space: nowrap;
  }

  .sidebar-divider {
    height: 1px;
    background: var(--color-border);
    margin: var(--space-2) 0;

    .sidebar-collapsed & {
      margin: var(--space-1) var(--space-2);
    }
  }

  .nav-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin: 0 var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background var(--transition-fast);
    border: none;
    background: none;
    width: calc(100% - var(--space-2) * 2);
    text-align: left;

    &:hover {
      background: var(--color-surface-hover);
    }

    kbd {
      margin-left: auto;
      font-family: $font-mono;
      font-size: 0.6875rem;
      padding: 1px 5px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-tertiary);
    }
  }

  .sidebar-nav {
    flex: 1;
    @include flex-col;
    padding: var(--space-1) var(--space-2);

    .sidebar-collapsed & {
      align-items: center;
      padding: var(--space-1) 0;
    }
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    transition:
      background var(--transition-fast),
      color var(--transition-fast),
      border-color var(--transition-fast);
    border-left: 2px solid transparent;
    white-space: nowrap;
    min-height: 44px;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &.active {
      background: var(--color-accent-muted);
      color: var(--color-accent);
      border-left-color: var(--color-accent);
    }

    .sidebar-collapsed & {
      @include flex-center;
      width: 36px;
      height: 36px;
      min-height: 36px;
      padding: 0;
      border-left: none;
      border-radius: var(--radius-md);
    }
  }

  .nav-label {
    @include text-truncate;
  }

  .plan-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin: 0 var(--space-2);
    font-size: 0.75rem;
    color: var(--color-text-tertiary);

    &--pro {
      color: var(--color-accent);
    }

    .sidebar-collapsed & {
      justify-content: center;
      padding: var(--space-2) 0;
      margin: 0;
    }
  }

  .plan-label {
    font-weight: 500;
    white-space: nowrap;

    &--free {
      color: var(--color-text-tertiary);
    }
  }

  .plan-upgrade-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-warning);
    text-decoration: none;
    font-weight: 500;
    transition: opacity var(--transition-fast);

    &:hover {
      opacity: 0.8;
    }
  }

  .upgrade-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.6875rem;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    transition: opacity var(--transition-fast);

    &:hover {
      opacity: 0.9;
    }

    &--icon {
      @include flex-center;
      width: 24px;
      height: 24px;
      padding: 0;
      margin-left: 0;
      border-radius: var(--radius-full);
    }
  }

  .profile-section {
    position: relative;
    padding: var(--space-2);
    border-top: 1px solid var(--color-border);

    .sidebar-collapsed & {
      @include flex-center;
      padding: var(--space-2) 0;
    }
  }

  .profile-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    border: none;
    background: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast);
    text-align: left;
    overflow: hidden;

    &:hover {
      background: var(--color-surface-hover);
    }

    .sidebar-collapsed & {
      @include flex-center;
      width: 36px;
      height: 36px;
      padding: 0;
    }
  }

  .profile-avatar {
    width: 32px;
    height: 32px;
    min-width: 32px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;

    .sidebar-collapsed & {
      width: 28px;
      height: 28px;
      min-width: 28px;
    }

    &--initials {
      @include flex-center;
      background: var(--color-accent);
      color: var(--color-accent-text);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
  }

  .profile-name {
    flex: 1;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
    @include text-truncate;
  }

  :global(.profile-chevron) {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
    transition: transform var(--transition-fast);
  }

  .profile-trigger[aria-expanded='true'] :global(.profile-chevron) {
    transform: rotate(180deg);
  }

  .main-content {
    flex: 1;
    min-width: 0;
    padding: var(--space-6);
    overflow: auto;
  }

  .mobile-menu-btn {
    display: none;
    position: fixed;
    top: var(--space-3);
    left: var(--space-3);
    z-index: $z-dropdown;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-md);
    cursor: pointer;
    @include touch-target;
  }

  .sidebar-backdrop {
    display: none;
    @include backdrop(0.5);
    z-index: $z-sidebar - 1;
  }

  @include mobile {
    .mobile-menu-btn {
      @include flex-center;
    }

    .sidebar {
      position: fixed;
      inset-block: 0;
      left: 0;
      z-index: $z-sidebar;
      transform: translateX(-100%);
      transition: transform var(--transition-base);
      width: var(--sidebar-width) !important;

      &.mobile-open {
        transform: translateX(0);
      }
    }

    .sidebar-backdrop {
      display: block;
    }

    .collapse-btn {
      display: none;
    }

    .main-content {
      padding: var(--space-4);
      padding-top: 56px;
    }
  }

  .connection-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: $z-progress;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-4);
    background: var(--color-warning);
    color: var(--color-text);
    font-size: 0.75rem;
    font-weight: 500;

    @include mobile {
      font-size: 0.6875rem;
      padding: var(--space-1) var(--space-2);
      text-align: center;
      flex-wrap: wrap;
    }
  }

  .connection-banner.capacity {
    background: var(--color-danger);
    color: var(--color-accent-text);
  }

  .connection-banner.google-auth {
    background: var(--color-danger);
    color: var(--color-accent-text);

    a {
      color: inherit;
      text-decoration: underline;
    }
  }

  .banner-dismiss {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: var(--space-1);
    margin-left: var(--space-2);
    opacity: 0.8;

    &:hover {
      opacity: 1;
    }
  }

  .connection-toast {
    position: fixed;
    top: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    z-index: $z-progress;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--color-success);
    color: var(--color-accent-text);
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: var(--radius-lg);
    animation: toast-slide-in 0.3s ease-out;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  @keyframes toast-slide-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-0.5rem);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .system-error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
    background: var(--color-danger-muted, rgba(239, 68, 68, 0.1));
    color: var(--color-danger);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--color-accent);
    z-index: $z-progress;
    animation: nav-progress-indeterminate 1.2s ease infinite;
  }

  @keyframes nav-progress-indeterminate {
    0% {
      transform: translateX(-100%);
    }
    50% {
      transform: translateX(0%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-progress {
      animation: none;
    }
  }
</style>
