<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BRAND } from '@fluxure/shared';

  let {
    children,
  }: {
    children: Snippet;
  } = $props();
</script>

<div class="auth-layout">
  <div class="auth-wrapper">
    <div class="auth-logo">
      <img src="/logo-mark.svg" alt="" width="32" height="32" />
      <span>fluxure</span>
    </div>
    <div class="auth-card">
      {@render children()}
    </div>
    <div class="auth-footer">
      &copy; {new Date().getFullYear()} Fluxure &middot;
      <a href="{BRAND.landingUrl}/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
      &middot;
      <a href="{BRAND.landingUrl}/terms" target="_blank" rel="noopener noreferrer">Terms</a>
    </div>
  </div>
</div>
