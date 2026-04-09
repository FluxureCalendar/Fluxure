<script lang="ts">
  import Plus from 'lucide-svelte/icons/plus';
  import { quickAdd } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';

  let {
    onadded,
  }: {
    onadded?: () => void;
  } = $props();

  let input = $state('');
  let loading = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    loading = true;
    try {
      const result = await quickAdd.parse(text);
      if (result.created) {
        showToast(`${result.type} created`, 'success');
        input = '';
        onadded?.();
      } else if (result.error) {
        showToast(result.error, 'error');
      }
    } catch (err) {
      if (err instanceof Error && !('handled' in err)) {
        showToast('Failed to create item', 'error');
      }
    } finally {
      loading = false;
    }
  }
</script>

<form class="quick-add" onsubmit={handleSubmit}>
  <Plus size={18} />
  <input
    bind:value={input}
    type="text"
    placeholder="Quick add — e.g. &quot;Run 30m daily at 7am&quot;"
    class="quick-add-input"
    disabled={loading}
  />
  {#if input.trim()}
    <button type="submit" class="btn-primary quick-add-btn" disabled={loading}> Add </button>
  {/if}
</form>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .quick-add {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    color: var(--color-text-tertiary);
  }

  .quick-add-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: $font-body;
    font-size: 0.9375rem;
    outline: none;

    &::placeholder {
      color: var(--color-text-tertiary);
      opacity: 0.5;
    }

    &:disabled {
      opacity: var(--opacity-disabled);
    }
  }

  .quick-add-btn {
    height: 28px;
    padding: 0 var(--space-3);
    font-size: 0.75rem;
    flex-shrink: 0;
  }
</style>
