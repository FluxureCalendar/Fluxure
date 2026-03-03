<script lang="ts">
  import '$lib/styles/main.scss';
  import { BRAND } from '@fluxure/shared';

  let { children } = $props();
</script>

<div class="booking-shell">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="booking-header" aria-label="Fluxure">
    <span class="booking-logo">F</span>
    <span class="booking-brand">{BRAND.name}</span>
  </header>
  <main class="booking-main" id="main-content">
    {@render children()}
  </main>
  <footer class="booking-footer">
    <span>Powered by {BRAND.name}</span>
  </footer>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .booking-shell {
    min-height: 100vh;
    background: var(--color-bg);
    @include flex-col;
    align-items: center;
  }

  .booking-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    width: 100%;
    max-width: 560px;
  }

  .booking-logo {
    @include flex-center;
    width: 28px;
    height: 28px;
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-radius: var(--radius-md);
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }

  .booking-brand {
    font-weight: 600;
    font-size: 15px;
    color: var(--color-text);
  }

  .booking-main {
    flex: 1;
    width: 100%;
    max-width: 560px;
    padding: 0 var(--space-6);
  }

  .booking-footer {
    padding: var(--space-6);
    color: var(--color-text-tertiary);
    font-size: 0.75rem;
  }

  @include mobile {
    .booking-header {
      padding: var(--space-3) var(--space-4);
    }
    .booking-main {
      padding: 0 var(--space-4);
    }
  }
</style>
