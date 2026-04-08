<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { goto, afterNavigate } from '$app/navigation';
  import { navigating } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import '$lib/styles/main.scss';

  import { getAuthState, checkAuth } from '$lib/auth.svelte';
  import { subscribe, subscribeConnectionState, type ConnectionState } from '$lib/ws';
  import { showToast } from '$lib/toast.svelte';
  import { getTheme, setTheme, initTheme, type Theme } from '$lib/theme.svelte';

  import Toast from '$lib/components/Toast.svelte';
  import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
  import SearchPalette from '$lib/components/SearchPalette.svelte';
  import ProfileMenu from '$lib/components/ProfileMenu.svelte';

  import LayoutDashboard from 'lucide-svelte/icons/layout-dashboard';
  import Flame from 'lucide-svelte/icons/flame';
  import CircleCheckBig from 'lucide-svelte/icons/circle-check-big';

  import Brain from 'lucide-svelte/icons/brain';
  import ExternalLink from 'lucide-svelte/icons/external-link';
  import TrendingUp from 'lucide-svelte/icons/trending-up';
  import Search from 'lucide-svelte/icons/search';
  import Menu from 'lucide-svelte/icons/menu';
  import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
  import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
  import X from 'lucide-svelte/icons/x';
  import Sun from 'lucide-svelte/icons/sun';
  import Moon from 'lucide-svelte/icons/moon';
  import Monitor from 'lucide-svelte/icons/monitor';

  let { children }: { children: Snippet } = $props();

  const auth = getAuthState();

  // Public routes that don't need the sidebar layout
  const publicRoutes = [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/onboarding',
    '/book',
    '/pricing',
  ];

  let currentPath = $derived(page.url.pathname);
  let isPublicRoute = $derived(
    publicRoutes.some((r) => currentPath === r || currentPath.startsWith(r + '/')),
  );
  let showAppShell = $derived(auth.isAuthenticated && !isPublicRoute);

  // Sidebar state
  let sidebarCollapsed = $state(false);
  let mobileMenuOpen = $state(false);
  let searchOpen = $state(false);
  let connectionStatus = $state<ConnectionState>('connecting');

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/habits', label: 'Habits', icon: Flame },
    { href: '/tasks', label: 'Tasks', icon: CircleCheckBig },
    { href: '/focus', label: 'Focus time', icon: Brain },
  ];

  const secondaryNavItems = [
    { href: '/links', label: 'Links', icon: ExternalLink },
    { href: '/analytics', label: 'Analytics', icon: TrendingUp },
  ];

  function isActive(href: string): boolean {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  }

  let theme = $derived(getTheme());

  const themeOrder: Theme[] = ['light', 'dark', 'system'];
  const themeLabels: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

  function cycleTheme() {
    const idx = themeOrder.indexOf(getTheme());
    setTheme(themeOrder[(idx + 1) % themeOrder.length]);
  }

  onMount(() => {
    // Hydrate the body
    document.body.classList.add('hydrated');

    // Initialize theme from localStorage
    initTheme();

    // Restore sidebar state
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored === 'true') sidebarCollapsed = true;

    // Check auth on app routes
    if (!isPublicRoute) {
      checkAuth().then((user) => {
        if (!user) goto('/login');
      });
    }
  });

  // Connect WS reactively — re-runs when isPublicRoute changes (e.g., after onboarding → dashboard)
  $effect(() => {
    if (isPublicRoute) return;

    const unsubConn = subscribeConnectionState((state) => {
      connectionStatus = state;
    });

    const unsubMsg = subscribe((msg) => {
      if (msg.type === 'google_auth_required') {
        showToast('Google Calendar disconnected. Reconnect in Settings.', 'error');
      } else if (msg.type === 'system_message') {
        const payload = msg.data as { level?: string; message?: string } | undefined;
        const level = payload?.level === 'error' ? 'error' : 'info';
        const text = payload?.message || msg.reason || 'Something went wrong';
        showToast(text, level);
      }
    });

    return () => {
      unsubConn();
      unsubMsg();
    };
  });

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed));
  }

  function closeMobileMenu() {
    mobileMenuOpen = false;
  }

  let pageTransition = $state(false);

  afterNavigate(() => {
    // Trigger a brief fade-in on new page content
    pageTransition = false;
    requestAnimationFrame(() => {
      pageTransition = true;
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchOpen = !searchOpen;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<a href="#main-content" class="skip-link">Skip to content</a>

{#if $navigating}
  <div class="nav-progress" aria-hidden="true"></div>
{/if}

{#if showAppShell}
  <div class="app-shell" class:sidebar-collapsed={sidebarCollapsed}>
    <!-- Mobile menu toggle -->
    <button class="mobile-menu-btn" onclick={() => (mobileMenuOpen = true)} aria-label="Open menu">
      <Menu size={20} />
    </button>

    <!-- Sidebar backdrop (mobile) -->
    {#if mobileMenuOpen}
      <div class="sidebar-backdrop" role="presentation" onclick={closeMobileMenu}></div>
    {/if}

    <!-- Sidebar -->
    <aside class="sidebar" class:sidebar-mobile-open={mobileMenuOpen} aria-label="Main navigation">
      <div class="sidebar-header">
        <a href="/" class="sidebar-logo">
          <img src="/logo-mark.svg" alt="" width="28" height="28" />
          {#if !sidebarCollapsed}
            <span class="sidebar-wordmark">fluxure</span>
          {/if}
        </a>
        <button class="mobile-close-btn" onclick={closeMobileMenu} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <nav class="sidebar-nav">
        <div class="nav-section">
          {#each navItems as item (item.href)}
            <a
              href={item.href}
              class="nav-item"
              class:nav-active={isActive(item.href)}
              onclick={closeMobileMenu}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              <item.icon size={16} />
              {#if !sidebarCollapsed}
                <span>{item.label}</span>
              {/if}
            </a>
          {/each}
        </div>

        <div class="nav-divider"></div>

        <div class="nav-section">
          {#each secondaryNavItems as item (item.href)}
            <a
              href={item.href}
              class="nav-item"
              class:nav-active={isActive(item.href)}
              onclick={closeMobileMenu}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              <item.icon size={16} />
              {#if !sidebarCollapsed}
                <span>{item.label}</span>
              {/if}
            </a>
          {/each}
        </div>

        {#if !sidebarCollapsed}
          <button class="nav-item nav-search" onclick={() => (searchOpen = true)}>
            <Search size={18} />
            <span>Search</span>
            <kbd>Ctrl+K</kbd>
          </button>
        {:else}
          <button
            class="nav-item nav-search"
            onclick={() => (searchOpen = true)}
            aria-label="Search"
          >
            <Search size={18} />
          </button>
        {/if}
      </nav>

      <div class="sidebar-footer">
        {#if auth.user}
          <ProfileMenu
            user={{
              name: auth.user.name,
              email: auth.user.email,
              plan: auth.user.plan,
              avatarUrl: auth.user.avatarUrl,
            }}
            collapsed={sidebarCollapsed}
          />
        {/if}
        <div class="sidebar-footer-actions">
          <button
            class="theme-toggle"
            onclick={cycleTheme}
            aria-label="Theme: {themeLabels[theme]}"
            title={themeLabels[theme]}
          >
            {#if theme === 'light'}
              <Sun size={16} />
            {:else if theme === 'dark'}
              <Moon size={16} />
            {:else}
              <Monitor size={16} />
            {/if}
            {#if !sidebarCollapsed}
              <span class="theme-label">{themeLabels[theme]}</span>
            {/if}
          </button>
          <button
            class="collapse-toggle"
            onclick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {#if sidebarCollapsed}
              <PanelLeftOpen size={16} />
            {:else}
              <PanelLeftClose size={16} />
            {/if}
          </button>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <div class="main-wrapper">
      <ConnectionBanner status={connectionStatus} />
      <main
        id="main-content"
        class="main-content"
        class:page-loading={$navigating}
        class:page-entered={pageTransition}
      >
        {@render children()}
      </main>
    </div>
  </div>
{:else}
  <!-- Public/auth routes: no app shell -->
  <main id="main-content" class="page-transition" class:page-entered={pageTransition}>
    {@render children()}
  </main>
{/if}

<Toast />
<SearchPalette open={searchOpen} onclose={() => (searchOpen = false)} />

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .app-shell {
    display: flex;
    min-height: 100vh;
  }

  // ---- Sidebar — left margin of a book ----
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--sidebar-width);
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
    z-index: $z-sidebar;
    display: flex;
    flex-direction: column;
    transition: width var(--transition-base);

    .sidebar-collapsed & {
      width: var(--sidebar-collapsed-width);
    }

    @include mobile {
      transform: translateX(-100%);
      transition: transform var(--transition-slow);
      width: var(--sidebar-width) !important;

      &.sidebar-mobile-open {
        transform: translateX(0);
      }
    }
  }

  .sidebar-backdrop {
    @include backdrop;
    display: none;

    @include mobile {
      display: block;
    }
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-3);
    height: 48px;
  }

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
  }

  .sidebar-wordmark {
    font-family: $font-heading;
    font-weight: 600;
    font-size: 1.0625rem;
    letter-spacing: -0.01em;
    opacity: 0.8;
  }

  .mobile-close-btn {
    @include icon-btn(28px);
    display: none;

    @include mobile {
      display: flex;
    }
  }

  .mobile-menu-btn {
    @include icon-btn(36px);
    position: fixed;
    top: var(--space-3);
    left: var(--space-3);
    z-index: $z-sidebar - 1;
    display: none;

    @include mobile {
      display: flex;
    }
  }

  // ---- Navigation — quiet, tight ----
  .sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--space-1) var(--space-2);
    overflow-y: auto;
  }

  .nav-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .nav-divider {
    height: 0;
    margin: var(--space-3) 0;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 6px var(--space-3);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    text-decoration: none;
    border: none;
    background: transparent;
    cursor: pointer;
    font-family: $font-body;
    width: 100%;
    text-align: left;
    transition:
      color var(--transition-fast),
      opacity var(--transition-fast);

    :global(svg) {
      opacity: 0.5;
      transition: opacity var(--transition-fast);
    }

    &:hover {
      color: var(--color-text);

      :global(svg) {
        opacity: 0.8;
      }
    }

    .sidebar-collapsed & {
      justify-content: center;
      padding: 6px;

      span,
      kbd {
        display: none;
      }
    }
  }

  .nav-active {
    color: var(--color-accent);
    position: relative;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 25%;
      bottom: 25%;
      width: 2px;
      background: var(--color-accent);
      border-radius: var(--radius-full);
    }

    :global(svg) {
      opacity: 1;
    }

    &:hover {
      color: var(--color-accent);

      :global(svg) {
        opacity: 1;
      }
    }

    .sidebar-collapsed & {
      &::before {
        left: 0;
        top: 30%;
        bottom: 30%;
      }
    }
  }

  .nav-search {
    margin-top: auto;

    kbd {
      margin-left: auto;
      font-family: $font-mono;
      font-size: 0.625rem;
      color: var(--color-text-tertiary);
      opacity: 0.6;
    }
  }

  // ---- Sidebar footer ----
  .sidebar-footer {
    padding: var(--space-1) 0;
    border-top: 1px solid var(--color-separator);
    margin-top: auto;
  }

  .sidebar-footer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-2);

    .sidebar-collapsed & {
      flex-direction: column;
      gap: var(--space-1);
      padding: 0;
    }
  }

  .theme-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-family: $font-body;
    font-size: 0.6875rem;
    padding: var(--space-1) var(--space-2);
    opacity: 0.5;
    transition: opacity var(--transition-fast);

    &:hover {
      opacity: 1;
    }

    .sidebar-collapsed & {
      @include icon-btn(28px);
      opacity: 0.5;
      &:hover {
        opacity: 1;
      }
    }
  }

  .theme-label {
    .sidebar-collapsed & {
      display: none;
    }
  }

  .collapse-toggle {
    @include icon-btn(28px);
    display: flex;
    opacity: 0.4;
    transition: opacity var(--transition-fast);
    &:hover {
      opacity: 1;
    }

    @include mobile {
      display: none;
    }
  }

  // ---- Main content ----
  .main-wrapper {
    flex: 1;
    margin-left: var(--sidebar-width);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    transition: margin-left var(--transition-base);
    position: relative;

    .sidebar-collapsed & {
      margin-left: var(--sidebar-collapsed-width);
    }

    @include mobile {
      margin-left: 0 !important;
    }
  }

  .main-content {
    flex: 1;
    padding: var(--space-8);
    position: relative;
    z-index: 1;
    opacity: 0;

    &.page-entered {
      opacity: 1;
      transition: opacity 200ms var(--ease-calm);
    }

    &.page-loading {
      opacity: 0.5;
      pointer-events: none;
      transition: opacity 150ms ease;
    }

    @include mobile {
      padding: var(--space-4);
      padding-top: 48px;
    }
  }

  // Public/auth route transition
  .page-transition {
    opacity: 0;

    &.page-entered {
      opacity: 1;
      transition: opacity 250ms var(--ease-calm);
    }
  }

  // ---- Navigation progress bar ----
  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    z-index: $z-toast + 1;
    background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
    animation: nav-slide 1.2s ease-in-out infinite;
    box-shadow: 0 0 8px rgba(74, 144, 164, 0.3);

    @media (prefers-color-scheme: light) {
      height: 4px;
      background: linear-gradient(
        90deg,
        transparent 5%,
        var(--color-accent) 40%,
        var(--color-accent) 60%,
        transparent 95%
      );
      box-shadow: 0 1px 6px rgba(61, 143, 164, 0.45);
    }
  }

  @keyframes nav-slide {
    0% {
      transform: translateX(-100%);
    }
    50% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
