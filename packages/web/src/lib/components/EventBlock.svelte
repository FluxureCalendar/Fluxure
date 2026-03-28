<script lang="ts">
  let {
    type,
    title,
    time,
    subtitle,
    onclick,
  }: {
    type: 'habit' | 'task' | 'meeting' | 'focus' | 'external';
    title: string;
    time: string;
    subtitle?: string;
    onclick?: () => void;
  } = $props();
</script>

{#if onclick}
  <button class="event-block event-{type}" {onclick} type="button">
    <span class="event-title">{title}</span>
    <span class="event-time">{time}</span>
    {#if subtitle}
      <span class="event-subtitle">{subtitle}</span>
    {/if}
  </button>
{:else}
  <div class="event-block event-{type}">
    <span class="event-title">{title}</span>
    <span class="event-time">{time}</span>
    {#if subtitle}
      <span class="event-subtitle">{subtitle}</span>
    {/if}
  </div>
{/if}

<style lang="scss">
  .event-block {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px var(--space-3);
    border-radius: var(--radius-md);
    border-left: 2px solid var(--event-color);
    background: var(--event-bg);
    width: 100%;
    text-align: left;
    border-top: none;
    border-right: none;
    border-bottom: none;
    cursor: default;
    font-family: inherit;

    &[type='button'] {
      cursor: pointer;
      transition: background-color var(--transition-fast);

      &:hover {
        filter: brightness(0.97);
      }
    }
  }

  .event-habit {
    --event-color: var(--color-habit-border);
    --event-bg: var(--color-habit-bg);
  }

  .event-task {
    --event-color: var(--color-task-border);
    --event-bg: var(--color-task-bg);
  }

  .event-meeting {
    --event-color: var(--color-meeting-border);
    --event-bg: var(--color-meeting-bg);
  }

  .event-focus {
    --event-color: var(--color-focus-border);
    --event-bg: var(--color-focus-bg);
  }

  .event-external {
    --event-color: var(--color-external-border);
    --event-bg: var(--color-external-bg);
  }

  .event-title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
    line-height: 1.3;
  }

  .event-time {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .event-subtitle {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    opacity: 0.6;
  }
</style>
