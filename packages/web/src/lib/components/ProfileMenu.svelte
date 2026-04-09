<script lang="ts">
  import { slide } from 'svelte/transition';
  import Settings from 'lucide-svelte/icons/settings';
  import LogOut from 'lucide-svelte/icons/log-out';
  import ChevronUp from 'lucide-svelte/icons/chevron-up';
  import { logout } from '$lib/auth.svelte';
  import { goto } from '$app/navigation';

  let {
    user,
    collapsed = false,
  }: {
    user: { name: string; email: string; plan?: string; avatarUrl?: string };
    collapsed?: boolean;
  } = $props();

  let open = $state(false);
  let menuEl: HTMLDivElement | undefined = $state();

  function handleClickOutside(e: MouseEvent) {
    if (open && menuEl && !menuEl.contains(e.target as Node)) {
      open = false;
    }
  }

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
    }
  }

  async function handleLogout() {
    open = false;
    await logout();
  }

  function handleSettings() {
    open = false;
    goto('/settings');
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div class="profile-menu" bind:this={menuEl}>
  {#if open}
    <div
      class="profile-drawer"
      role="menu"
      aria-label="Profile options"
      transition:slide={{ duration: 150 }}
    >
      <button class="profile-drawer-item" role="menuitem" onclick={handleSettings}>
        <Settings size={16} />
        {#if !collapsed}<span>Settings</span>{/if}
      </button>
      <button
        class="profile-drawer-item profile-drawer-danger"
        role="menuitem"
        onclick={handleLogout}
      >
        <LogOut size={16} />
        {#if !collapsed}<span>Sign out</span>{/if}
      </button>
    </div>
  {/if}

  <button
    class="profile-trigger"
    onclick={() => (open = !open)}
    aria-label="Profile menu"
    aria-expanded={open}
  >
    {#if user.avatarUrl}
      <img class="avatar avatar-img" src={user.avatarUrl} alt="{user.name}'s avatar" />
    {:else}
      <span class="avatar">{getInitials(user.name)}</span>
    {/if}
    {#if !collapsed}
      <span class="profile-info">
        <span class="profile-name-row">
          <span class="profile-name">{user.name}</span>
          {#if user.plan}
            <span class="plan-badge" class:plan-pro={user.plan === 'pro'}>
              {user.plan === 'pro' ? 'Pro' : 'Free'}
            </span>
          {/if}
        </span>
      </span>
      <span class="profile-chevron" class:profile-chevron-open={open}>
        <ChevronUp size={14} />
      </span>
    {/if}
  </button>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .profile-menu {
    padding: var(--space-2);

    :global(.sidebar-collapsed) & {
      padding: var(--space-1);
    }
  }

  .profile-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition-fast),
      opacity var(--transition-fast);
    opacity: 0.85;

    &:hover {
      opacity: 1;
      background: var(--color-surface-hover);
    }

    :global(.sidebar-collapsed) & {
      justify-content: center;
    }
  }

  .profile-chevron {
    display: flex;
    align-items: center;
    margin-left: auto;
    color: var(--color-text-tertiary);
    transition: transform var(--transition-fast);
    flex-shrink: 0;

    &.profile-chevron-open {
      transform: rotate(180deg);
    }
  }

  .avatar {
    @include flex-center;
    width: 28px;
    height: 28px;
    min-width: 28px;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.6875rem;
    font-weight: 600;
    font-family: $font-body;
  }

  .avatar-img {
    object-fit: cover;
  }

  .profile-info {
    @include flex-col;
    overflow: hidden;
    min-width: 0;
  }

  .profile-name-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .profile-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
    @include text-truncate;
  }

  .plan-badge {
    font-size: 0.5625rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    background: var(--color-surface-hover);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;

    &.plan-pro {
      color: var(--color-accent);
      background: var(--color-accent-muted);
      border: 1px solid var(--color-accent);
    }
  }

  // ─── Drawer (inline, not overlay) ──────────────────────────

  .profile-drawer {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-1);
    margin-bottom: var(--space-2);

    :global(.sidebar-collapsed) & {
      align-items: center;
      padding: 0;
    }
  }

  .profile-drawer-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font-family: $font-body;
    font-size: 0.8125rem;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);

    :global(svg) {
      flex-shrink: 0;
      opacity: 0.6;
    }

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);

      :global(svg) {
        opacity: 0.9;
      }
    }

    :global(.sidebar-collapsed) & {
      justify-content: center;
      padding: var(--space-2);
      width: auto;
    }
  }

  .profile-drawer-danger {
    &:hover {
      color: var(--color-error, #ea4335);

      :global(svg) {
        opacity: 1;
      }
    }
  }
</style>
