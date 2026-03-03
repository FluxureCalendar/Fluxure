<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import House from 'lucide-svelte/icons/house';
</script>

<div class="error-page">
  <div class="error-content">
    <TriangleAlert size={48} strokeWidth={1.5} />
    <h1>{page.status}</h1>
    <p class="error-message">
      {#if page.status === 404}
        The page you're looking for doesn't exist.
      {:else}
        Something went wrong. Please try again.
      {/if}
    </p>
    {#if page.error?.message}
      <p class="error-detail">{page.error.message}</p>
    {/if}
    <a href={resolve('/')} class="error-home-btn">
      <House size={16} strokeWidth={1.5} />
      Go home
    </a>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .error-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--space-6);
    background: var(--color-bg);
  }

  .error-content {
    text-align: center;
    max-width: 420px;
    color: var(--color-text-secondary);
  }

  h1 {
    font-size: 3rem;
    font-weight: 700;
    color: var(--color-text);
    margin: var(--space-4) 0 var(--space-2);
    line-height: 1;
  }

  .error-message {
    font-size: 1rem;
    margin-bottom: var(--space-2);
  }

  .error-detail {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-4);
  }

  .error-home-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-radius: var(--radius-md);
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 500;
    transition: opacity var(--transition-fast);
    margin-top: var(--space-4);

    &:hover {
      opacity: 0.9;
    }
  }
</style>
