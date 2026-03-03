<script lang="ts">
  import { tick } from 'svelte';
  import X from 'lucide-svelte/icons/x';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children?: import('svelte').Snippet;
  }

  let { open, title, onclose, children }: Props = $props();

  let panelEl = $state<HTMLDivElement | null>(null);
  let triggerEl: HTMLElement | null = null;

  function focusFirstInPanel() {
    if (!panelEl) return;
    const focusable = panelEl.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
      return;
    }
    if (e.key !== 'Tab' || !panelEl) return;
    const focusable = panelEl.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleClose() {
    onclose();
    triggerEl?.focus();
    triggerEl = null;
  }

  $effect(() => {
    if (open) {
      triggerEl = document.activeElement as HTMLElement;
      tick().then(() => focusFirstInPanel());
    }
  });
</script>

{#if open}
  <div class="panel-backdrop" onclick={handleClose} aria-hidden="true"></div>
  <div
    class="panel-slideover"
    role="dialog"
    aria-modal="true"
    aria-labelledby="panel-title"
    tabindex="-1"
    bind:this={panelEl}
    onkeydown={trapFocus}
  >
    <div class="panel-header">
      <h2 id="panel-title" class="panel-title">
        {title}
      </h2>
      <button onclick={handleClose} class="panel-close-btn" aria-label="Close panel">
        <X size={20} strokeWidth={1.5} />
      </button>
    </div>

    {@render children?.()}
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .panel-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }
</style>
