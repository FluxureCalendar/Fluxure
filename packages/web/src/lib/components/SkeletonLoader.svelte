<script lang="ts">
  let {
    lines = 3,
    width = '100%',
  }: {
    lines?: number;
    width?: string;
  } = $props();
</script>

<div class="skeleton-container" style:width aria-hidden="true">
  {#each Array(lines) as _, i (i)}
    <div
      class="skeleton-line"
      style:width={i === lines - 1 ? '60%' : '100%'}
      style:animation-delay="{i * 80}ms"
    ></div>
  {/each}
</div>

<style>
  .skeleton-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
