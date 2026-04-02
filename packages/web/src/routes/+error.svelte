<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>Error - Fluxure</title>
</svelte:head>

<div class="error-page">
  <h1>{page.status}</h1>
  <p>{page.error?.message || 'Something went wrong'}</p>
  <a href="/">Go home</a>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .error-page {
    @include flex-center;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 60vh;
    text-align: center;

    h1 {
      font-family: $font-heading;
      font-weight: 600;
      font-size: 5rem;
      color: var(--color-text);
      letter-spacing: -0.03em;
      opacity: 0.3;
    }

    p {
      color: var(--color-text-tertiary);
      font-size: 0.9375rem;
      max-width: 320px;
    }

    a {
      color: var(--color-accent);
      font-size: 0.8125rem;
      margin-top: var(--space-2);
    }
  }
</style>
