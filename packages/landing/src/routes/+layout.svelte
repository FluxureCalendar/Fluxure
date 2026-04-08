<script lang="ts">
  import '$lib/styles/main.scss';
  import Sun from 'lucide-svelte/icons/sun';
  import Moon from 'lucide-svelte/icons/moon';
  import { onMount } from 'svelte';
  import { APP_NAME, TAGLINE, DESCRIPTION, APP_URL, GITHUB_URL } from '$lib/config';
  import { initTheme, toggleTheme } from '$lib/theme';

  let { children } = $props();
  let scrolled = $state(false);
  let isDark = $state(false);

  onMount(() => {
    isDark = initTheme() === 'dark';
  });

  function handleScroll() {
    scrolled = window.scrollY > 80;
  }

  function handleToggle() {
    isDark = toggleTheme() === 'dark';
  }

  const jsonLdData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Fluxure',
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Web',
    description:
      'Intelligent calendar scheduling that automatically places habits, tasks, and focus time around your existing events.',
    offers: [
      { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Cloud Free' },
      {
        '@type': 'Offer',
        price: '9',
        priceCurrency: 'USD',
        name: 'Cloud Pro',
        billingIncrement: 'P1M',
      },
    ],
  });
</script>

<svelte:window onscroll={handleScroll} />

<svelte:head>
  <title>{APP_NAME} — {TAGLINE}</title>
  <meta name="description" content={DESCRIPTION} />
  <meta property="og:title" content="{APP_NAME} — {TAGLINE}" />
  <meta property="og:description" content={DESCRIPTION} />
  <meta property="og:url" content="https://fluxure.app" />
  <link rel="canonical" href="https://fluxure.app" />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static JSON-LD, no user input -->
  {@html `<script type="application/ld+json">${jsonLdData}<` + '/script>'}
</svelte:head>

<div class="layout">
  <header class="header" class:scrolled>
    <div class="header-inner">
      <a class="header-brand" href="/">
        <img src="/logo-mark.svg" alt="" width="28" height="28" />
        <span class="header-name">fluxure</span>
      </a>

      <div class="header-actions">
        <button
          class="theme-toggle"
          onclick={handleToggle}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {#if isDark}
            <Sun size={18} />
          {:else}
            <Moon size={18} />
          {/if}
        </button>
        <a class="header-signin" href="{APP_URL}/login">Sign in</a>
        <a class="header-cta" href="{APP_URL}/signup">Get started</a>
      </div>
    </div>
  </header>

  <main>
    {@render children()}
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <div>
        <div class="footer-brand">
          <img src="/logo-mark.svg" alt="" width="24" height="24" />
          <span class="footer-name">fluxure</span>
        </div>
        <p class="footer-copy">&copy; {new Date().getFullYear()} {APP_NAME}</p>
      </div>

      <div class="footer-links">
        <div class="footer-col">
          <span class="footer-col-title">Product</span>
          <a class="footer-link" href="/#features">Features</a>
          <a class="footer-link" href="/pricing">Pricing</a>
        </div>
        <div class="footer-col">
          <span class="footer-col-title">Legal</span>
          <a class="footer-link" href="/terms">Terms</a>
          <a class="footer-link" href="/privacy">Privacy</a>
        </div>
        <div class="footer-col">
          <span class="footer-col-title">Connect</span>
          <a class="footer-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
            >GitHub</a
          >
        </div>
      </div>
    </div>
  </footer>
</div>

<style lang="scss">
  .layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
  }
</style>
