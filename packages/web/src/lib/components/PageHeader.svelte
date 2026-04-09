<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="page-header">
  <div class="page-header-left">
    <h1>{title}</h1>
    {#if subtitle}<p class="page-subtitle">{subtitle}</p>{/if}
  </div>
  {#if children}
    <div class="page-actions">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .page-header-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .page-subtitle {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }
</style>
