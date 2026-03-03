<script lang="ts">
  import { BRAND } from '@fluxure/shared';
  import { resolve } from '$app/paths';
  let { children } = $props();
</script>

<main class="auth-layout" aria-label="Authentication">
  <div class="auth-card">
    <div class="auth-logo">
      <span class="sidebar-logo">F</span>
      <span class="auth-brand">{BRAND.name}</span>
    </div>
    {@render children()}
  </div>
  <footer class="auth-footer">
    <span>&copy; {new Date().getFullYear()} {BRAND.name}</span>
    &middot;
    <a href={resolve('/privacy')}>Privacy</a>
    &middot;
    <a href={resolve('/terms')}>Terms</a>
  </footer>
</main>
