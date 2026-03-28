<script lang="ts">
  let {
    selected = $bindable(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    minSelection = 1,
  }: {
    selected: string[];
    minSelection?: number;
  } = $props();

  const days: [string, string][] = [
    ['mon', 'M'],
    ['tue', 'T'],
    ['wed', 'W'],
    ['thu', 'T'],
    ['fri', 'F'],
    ['sat', 'S'],
    ['sun', 'S'],
  ];

  function toggle(day: string) {
    if (selected.includes(day)) {
      if (selected.length > minSelection) {
        selected = selected.filter((d) => d !== day);
      }
    } else {
      selected = [...selected, day];
    }
  }
</script>

<div class="day-picker" role="group" aria-label="Select days">
  {#each days as [day, label] (day)}
    <button
      type="button"
      class="day-btn"
      class:day-active={selected.includes(day)}
      onclick={() => toggle(day)}
      aria-pressed={selected.includes(day)}
    >
      {label}
    </button>
  {/each}
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .day-picker {
    display: flex;
    gap: var(--space-1);
  }

  .day-btn {
    @include flex-center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-secondary);
    font-family: $font-body;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
    padding: 0;

    &:hover {
      background: var(--color-surface-hover);
    }

    &.day-active {
      background: var(--color-accent);
      color: var(--color-accent-text);
      border-color: var(--color-accent);
    }
  }
</style>
