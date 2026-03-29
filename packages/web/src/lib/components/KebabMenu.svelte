<script lang="ts">
  import type { Snippet } from 'svelte';
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';

  let {
    open = false,
    ontoggle,
    children,
  }: {
    open?: boolean;
    ontoggle: () => void;
    children: Snippet;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      ontoggle();
    }
  }

  $effect(() => {
    if (open) {
      window.addEventListener('keydown', handleKeydown);
      return () => window.removeEventListener('keydown', handleKeydown);
    }
  });
</script>

<div class="kebab-menu">
  <button class="kebab-trigger" onclick={ontoggle} aria-label="More options" aria-expanded={open}>
    <EllipsisVertical size={16} />
  </button>
  {#if open}
    <div class="kebab-dropdown" role="menu">
      {@render children()}
    </div>
  {/if}
</div>
