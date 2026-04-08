<script lang="ts">
  import type { Snippet } from 'svelte';
  import X from 'lucide-svelte/icons/x';

  let {
    open,
    title,
    onclose,
    children,
  }: {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  let panelEl: HTMLDivElement | undefined = $state();
  let previousFocus: HTMLElement | null = null;

  const FOCUSABLE_SELECTOR =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
      return;
    }

    if (e.key === 'Tab' && panelEl) {
      const focusableEls = Array.from(panelEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusableEls.length === 0) return;

      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function handleBackdropClick() {
    onclose();
  }

  $effect(() => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement;
      if (panelEl) {
        const focusable = panelEl.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      }
    } else {
      if (previousFocus) {
        previousFocus.focus();
        previousFocus = null;
      }
    }
  });
</script>

{#if open}
  <div class="slideover-backdrop" role="presentation" onclick={handleBackdropClick}></div>
  <div
    class="slideover"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={panelEl}
    onkeydown={handleKeydown}
  >
    <div class="slideover-header">
      <h3>{title}</h3>
      <button class="slideover-close" onclick={onclose} aria-label="Close panel">
        <X size={20} />
      </button>
    </div>
    <div class="slideover-body">
      {@render children()}
    </div>
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .slideover-close {
    @include icon-btn(28px);
    opacity: 0.4;
    transition: opacity var(--transition-fast);
    &:hover {
      opacity: 1;
    }
  }
</style>
