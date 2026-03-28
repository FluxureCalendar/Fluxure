<script lang="ts">
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lucide-svelte icons use legacy Svelte 4 component type
  type IconComponent = import('svelte').Component<any> | (new (...args: any[]) => any);

  let {
    icon,
    title,
    message,
    actionLabel,
    onaction,
  }: {
    icon?: IconComponent;
    title?: string;
    message?: string;
    actionLabel?: string;
    onaction?: () => void;
  } = $props();
</script>

<div class="empty-state empty-state-enter">
  {#if icon}
    {@const Icon = icon}
    <div class="empty-icon">
      <Icon size={40} />
    </div>
  {/if}
  {#if title}
    <p class="empty-title">{title}</p>
  {/if}
  {#if message}
    <p class="empty-desc">{message}</p>
  {/if}
  {#if actionLabel && onaction}
    <button class="btn-primary" onclick={onaction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .empty-state-enter {
    animation: contentEnter 300ms ease both;
    animation-delay: 250ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .empty-state-enter {
      animation: none;
    }
  }
</style>
