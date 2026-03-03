<script lang="ts">
  import type { CalEvent } from './dashboard-utils';

  interface Props {
    event: CalEvent;
    newStart: string;
    newEnd: string;
    editMin: number;
    editMax: number;
    onclose: () => void;
    onchoice: (choice: 'this' | 'habit') => void;
  }

  let { event, editMin = $bindable(), editMax = $bindable(), onclose, onchoice }: Props = $props();

  let habitResizeError = $derived(
    editMin > editMax ? 'Min duration cannot exceed max duration' : '',
  );
</script>

<div
  class="prompt-backdrop"
  onclick={onclose}
  onkeydown={(e) => {
    if (e.key === 'Escape') onclose();
  }}
  role="button"
  tabindex="-1"
  aria-label="Cancel"
></div>
<div class="prompt-modal" role="dialog" aria-modal="true" aria-labelledby="habit-resize-title">
  <h3 id="habit-resize-title" class="prompt-title">Update habit duration</h3>
  <p class="prompt-desc">
    You resized <strong>{event.title}</strong>. How should this change apply?
  </p>
  <div class="prompt-fields">
    <label class="prompt-field">
      <span class="prompt-field-label">Min duration (minutes)</span>
      <input
        type="number"
        class="prompt-field-input"
        min="5"
        max="1440"
        step="5"
        bind:value={editMin}
      />
    </label>
    <label class="prompt-field">
      <span class="prompt-field-label">Max duration (minutes)</span>
      <input
        type="number"
        class="prompt-field-input"
        min="5"
        max="1440"
        step="5"
        bind:value={editMax}
      />
    </label>
  </div>
  {#if habitResizeError}
    <p class="prompt-error">{habitResizeError}</p>
  {/if}
  <div class="prompt-actions">
    <button class="prompt-btn prompt-btn--secondary" onclick={() => onchoice('this')}>
      Just this event
    </button>
    <button
      class="prompt-btn prompt-btn--primary"
      disabled={!!habitResizeError}
      onclick={() => onchoice('habit')}
    >
      All future events
    </button>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .prompt-backdrop {
    @include backdrop;
    z-index: $z-modal;
  }

  .prompt-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: $z-modal + 1;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    max-width: 400px;
    width: calc(100% - var(--space-8));
    box-shadow: var(--shadow-lg);
  }

  .prompt-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-2);
  }

  .prompt-desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-4);
    line-height: 1.5;
  }

  .prompt-fields {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .prompt-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);

    &-label {
      font-size: 0.6875rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    &-input {
      padding: var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: 0.8125rem;
      font-family: var(--font-mono);
      width: 100%;

      &:focus {
        outline: none;
        border-color: var(--color-accent);
      }
    }
  }

  .prompt-error {
    font-size: 0.75rem;
    color: var(--color-danger);
    margin: 0 0 var(--space-3);
  }

  .prompt-actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
  }

  .prompt-btn {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--color-border);
    transition: background var(--transition-fast);

    &--secondary {
      background: var(--color-surface);
      color: var(--color-text);

      &:hover {
        background: var(--color-surface-hover);
      }
    }

    &--primary {
      background: var(--color-accent);
      color: var(--color-accent-text);
      border-color: var(--color-accent);

      &:hover:not(:disabled) {
        filter: brightness(0.9);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
</style>
