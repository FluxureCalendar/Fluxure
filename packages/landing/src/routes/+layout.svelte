<script lang="ts">
  import '$lib/styles/main.scss';
  import Menu from 'lucide-svelte/icons/menu';
  import X from 'lucide-svelte/icons/x';
  import Github from 'lucide-svelte/icons/github';

  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { APP_NAME, TAGLINE, DESCRIPTION, APP_URL, GITHUB_URL } from '$lib/config';

  let { children } = $props();
  let mobileMenuOpen = $state(false);
  let scrolled = $state(false);
  let activeSection = $state('');

  function scrollTo(id: string) {
    mobileMenuOpen = false;
    if (page.url.pathname !== '/') {
      goto(`/#${id}`).then(() => {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        });
      });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }

  function handleScroll() {
    scrolled = window.scrollY > 80;

    // Active section detection
    const sections = ['features', 'pricing', 'faq'];
    let current = '';
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 120 && rect.bottom > 120) {
          current = id;
        }
      }
    }
    activeSection = current;
  }
</script>

<svelte:window onscroll={handleScroll} />

<svelte:head>
  <title>{APP_NAME} — {TAGLINE}</title>
  <meta name="description" content={DESCRIPTION} />
</svelte:head>

<div class="layout">
  <header class="site-header" class:scrolled>
    <nav class="nav-container" aria-label="Main navigation">
      <a class="logo" href="/">{APP_NAME}</a>

      <div class="nav-links" class:open={mobileMenuOpen}>
        <button
          class="nav-link"
          class:active={activeSection === 'features'}
          onclick={() => scrollTo('features')}>Features</button
        >
        <button
          class="nav-link"
          class:active={activeSection === 'pricing'}
          onclick={() => scrollTo('pricing')}>Pricing</button
        >
        <button
          class="nav-link"
          class:active={activeSection === 'faq'}
          onclick={() => scrollTo('faq')}>FAQ</button
        >
        <a class="nav-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <Github size={16} />
          GitHub
        </a>
        <div class="nav-actions-mobile">
          <a class="btn btn-ghost" href="{APP_URL}/login">Log in</a>
          <a class="btn btn-primary" href="{APP_URL}/signup">Get Started</a>
        </div>
      </div>

      <div class="nav-actions">
        <a class="btn btn-ghost" href="{APP_URL}/login">Log in</a>
        <a class="btn btn-primary" href="{APP_URL}/signup">Get Started</a>
      </div>

      <button
        class="hamburger"
        onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
        aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileMenuOpen}
      >
        {#if mobileMenuOpen}
          <X size={24} />
        {:else}
          <Menu size={24} />
        {/if}
      </button>
    </nav>
  </header>

  <main>
    {@render children()}
  </main>

  <footer class="site-footer">
    <div class="footer-container">
      <div class="footer-grid">
        <div class="footer-brand">
          <span class="logo">{APP_NAME}</span>
          <p class="footer-tagline">{TAGLINE}.</p>
        </div>

        <div class="footer-col">
          <h4>Product</h4>
          <button class="footer-link" onclick={() => scrollTo('features')}>Features</button>
          <button class="footer-link" onclick={() => scrollTo('pricing')}>Pricing</button>
          <button class="footer-link" onclick={() => scrollTo('faq')}>FAQ</button>
        </div>

        <div class="footer-col">
          <h4>Legal</h4>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </div>

        <div class="footer-col">
          <h4>Connect</h4>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </div>

      <div class="footer-bottom">
        <p>&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
      </div>
    </div>
  </footer>
</div>

<!-- Mobile overlay always rendered but visibility controlled via opacity -->
<button
  class="mobile-overlay"
  class:visible={mobileMenuOpen}
  onclick={() => (mobileMenuOpen = false)}
  aria-label="Close menu"
  tabindex={mobileMenuOpen ? 0 : -1}
></button>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
  }

  // ---- Header ----
  .site-header {
    position: sticky;
    top: 0;
    z-index: $z-overlay;
    background: transparent;
    border-bottom: 1px solid transparent;
    transition:
      background var(--transition-base),
      border-color var(--transition-base),
      box-shadow var(--transition-base);

    &.scrolled {
      background: color-mix(in srgb, var(--color-bg) 85%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom-color: var(--color-border);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .site-header {
      transition: none;
    }
  }

  .nav-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 var(--space-6);
    height: 64px;
    @include flex-between;
  }

  .logo {
    font-family: $font-sans;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-text);
    text-decoration: none;
    letter-spacing: -0.02em;
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: var(--space-1);

    @include tablet {
      position: fixed;
      top: 64px;
      left: 0;
      right: 0;
      bottom: 0;
      flex-direction: column;
      align-items: stretch;
      background: var(--color-bg);
      padding: var(--space-4);
      gap: 0;
      z-index: $z-overlay;
      overflow-y: auto;

      // Slide + fade transition
      opacity: 0;
      transform: translateY(-8px);
      pointer-events: none;
      visibility: hidden;
      transition:
        opacity var(--transition-base),
        transform var(--transition-base),
        visibility var(--transition-base);

      &.open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
        visibility: visible;
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-links {
      @include tablet {
        transition: none;
        transform: none;
      }
    }
  }

  .nav-link {
    background: none;
    border: none;
    font-family: $font-sans;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-hover);
    }

    &.active {
      color: var(--color-accent);
    }

    @include tablet {
      padding: var(--space-3) var(--space-4);
      font-size: 1rem;
      border-radius: var(--radius-lg);
      justify-content: flex-start;
      min-height: 44px;
    }
  }

  .nav-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);

    @include tablet {
      display: none;
    }
  }

  .nav-actions-mobile {
    display: none;

    @include tablet {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin-top: var(--space-4);
      padding-top: var(--space-4);
      border-top: 1px solid var(--color-border);

      .btn {
        min-height: 44px;
      }
    }
  }

  .hamburger {
    display: none;
    background: none;
    border: none;
    color: var(--color-text);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    transition: background var(--transition-fast);
    min-width: 44px;
    min-height: 44px;

    &:hover {
      background: var(--color-surface-hover);
    }

    @include tablet {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  // ---- Buttons ----
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: $font-sans;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .btn-primary {
    background: var(--color-accent);
    color: var(--color-accent-text);

    &:hover {
      background: var(--color-accent-hover);
    }
  }

  .btn-ghost {
    background: transparent;
    color: var(--color-text-secondary);

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-hover);
    }
  }

  // ---- Footer ----
  .site-footer {
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
    margin-top: var(--space-24);
  }

  .footer-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-16) var(--space-6) var(--space-8);
  }

  .footer-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-12);

    @include tablet {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-8);
    }

    @include small {
      grid-template-columns: 1fr;
    }
  }

  .footer-brand {
    .logo {
      font-size: 1.125rem;
    }
  }

  .footer-tagline {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    margin: var(--space-2) 0 0;
  }

  .footer-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    h4 {
      font-size: 0.8125rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-tertiary);
      margin: 0 0 var(--space-1);
    }

    a,
    .footer-link {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      text-decoration: none;
      background: none;
      border: none;
      font-family: $font-sans;
      cursor: pointer;
      padding: 0;
      text-align: left;
      transition: color var(--transition-fast);

      &:hover {
        color: var(--color-text);
      }
    }
  }

  .footer-bottom {
    margin-top: var(--space-12);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);

    p {
      color: var(--color-text-tertiary);
      font-size: 0.8125rem;
      margin: 0;
    }
  }

  // ---- Mobile Overlay ----
  .mobile-overlay {
    display: none;

    @include tablet {
      display: block;
      position: fixed;
      inset: 0;
      top: 64px;
      background: var(--color-overlay);
      z-index: $z-overlay - 1;
      border: none;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-base);

      &.visible {
        opacity: 1;
        pointer-events: auto;
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mobile-overlay {
      transition: none;
    }
  }

  // Dark mode header shadow adjustment
  @media (prefers-color-scheme: dark) {
    .site-header.scrolled {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }
  }
</style>
