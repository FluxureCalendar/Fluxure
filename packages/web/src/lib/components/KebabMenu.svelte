<script lang="ts">
  import EllipsisVertical from 'lucide-svelte/icons/ellipsis-vertical';
  import { tick } from 'svelte';

  interface Props {
    open: boolean;
    ontoggle: (open: boolean) => void;
    itemName?: string;
    children?: import('svelte').Snippet;
  }

  let { open, ontoggle, itemName = '', children }: Props = $props();
  let menuEl = $state<HTMLElement | undefined>(undefined);

  $effect(() => {
    if (open && menuEl) {
      tick().then(() => {
        const first = menuEl?.querySelector<HTMLElement>('[role="menuitem"]');
        first?.focus();
      });
    }
  });

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    ontoggle(!open);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      ontoggle(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      );
      const current = Array.from(items).indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'ArrowDown'
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }
</script>

<span class="kebab-cell">
  <button
    class="kebab-btn"
    onclick={toggleMenu}
    aria-label={itemName ? `Actions for ${itemName}` : 'Actions'}
    aria-haspopup="menu"
    aria-expanded={open}
  >
    <EllipsisVertical size={16} strokeWidth={1.5} />
  </button>
  {#if open}
    <div
      class="kebab-menu"
      role="menu"
      tabindex="-1"
      bind:this={menuEl}
      onkeydown={handleKeydown}
      onclick={(e) => e.stopPropagation()}
    >
      {@render children?.()}
    </div>
  {/if}
</span>
