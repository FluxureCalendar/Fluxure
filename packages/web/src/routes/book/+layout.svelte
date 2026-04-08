<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BRAND } from '@fluxure/shared';

  let {
    children,
  }: {
    children: Snippet;
  } = $props();
</script>

<div class="booking-layout">
  <header class="booking-header">
    <a href="/" class="booking-logo">
      <img src="/logo-mark.svg" alt="" width="28" height="28" />
      <span class="booking-wordmark">fluxure</span>
    </a>
  </header>

  <main class="booking-main">
    {@render children()}
  </main>

  <footer class="booking-footer">
    <span>&copy; {new Date().getFullYear()} Fluxure</span>
    <span class="booking-sep">&middot;</span>
    <a href="{BRAND.landingUrl}/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
    <span class="booking-sep">&middot;</span>
    <a href="{BRAND.landingUrl}/terms" target="_blank" rel="noopener noreferrer">Terms</a>
  </footer>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .booking-layout {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
  }

  .booking-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4) var(--space-6);
  }

  .booking-logo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    opacity: 0.6;
  }

  .booking-wordmark {
    font-family: var(--font-heading, 'Fraunces', Georgia, serif);
    font-weight: 600;
    font-size: 1.0625rem;
    letter-spacing: -0.01em;
  }

  .booking-main {
    flex: 1;
    display: flex;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
  }

  .booking-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    font-size: 0.75rem;
    color: var(--color-text-tertiary);

    a {
      color: var(--color-text-tertiary);
      text-decoration: none;

      &:hover {
        color: var(--color-accent);
      }
    }
  }

  .booking-sep {
    color: var(--color-text-tertiary);
  }
</style>
