<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { pageTitle } from '$lib/brand';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SettingsGeneral from './SettingsGeneral.svelte';
  import SettingsCalendars from './SettingsCalendars.svelte';
  import SettingsTemplates from './SettingsTemplates.svelte';
  import SettingsBilling from './SettingsBilling.svelte';
  import SettingsAccount from './SettingsAccount.svelte';
  import SettingsPrivacy from './SettingsPrivacy.svelte';

  import Settings2 from 'lucide-svelte/icons/settings-2';
  import Calendar from 'lucide-svelte/icons/calendar';
  import Clock from 'lucide-svelte/icons/clock';
  import CreditCard from 'lucide-svelte/icons/credit-card';
  import UserIcon from 'lucide-svelte/icons/user';
  import Shield from 'lucide-svelte/icons/shield';

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'calendars', label: 'Calendars', icon: Calendar },
    { id: 'templates', label: 'Templates', icon: Clock },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'account', label: 'Account', icon: UserIcon },
    { id: 'privacy', label: 'Privacy', icon: Shield },
  ] as const;

  let activeTab = $state<string>('general');
  let generalDirty = $state(false);

  function switchTab(id: string) {
    if (generalDirty && activeTab === 'general') {
      if (!confirm('You have unsaved changes. Leave anyway?')) return;
    }
    activeTab = id;
  }

  afterNavigate(({ to }) => {
    const params = to?.url.searchParams;
    if (!params) return;

    const tab = params.get('tab');
    const highlight = params.get('highlight');

    if (tab && tabs.some((t) => t.id === tab)) {
      activeTab = tab;
    }

    if (highlight && /^[a-z-]+$/.test(highlight)) {
      // Wait for tab content to render
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.querySelector(`[data-setting-id="${highlight}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('setting-highlight');
            setTimeout(() => el.classList.remove('setting-highlight'), 2000);
          }
        }, 100);
      });
      window.history.replaceState({}, '', '/settings');
    }
  });
</script>

<svelte:head>
  <title>{pageTitle('Settings')}</title>
</svelte:head>

<PageHeader title="Settings" subtitle="Manage your account, calendars, and preferences" />

<div class="settings-layout">
  <nav class="settings-tabs" aria-label="Settings sections">
    {#each tabs as tab (tab.id)}
      <button
        class="settings-tab"
        class:settings-tab-active={activeTab === tab.id}
        onclick={() => switchTab(tab.id)}
        aria-selected={activeTab === tab.id}
      >
        <tab.icon size={15} />
        <span>{tab.label}</span>
      </button>
    {/each}
  </nav>

  <div class="settings-content">
    <div class="settings-panel">
      {#if activeTab === 'general'}
        <SettingsGeneral ondirtychange={(d) => (generalDirty = d)} />
      {:else if activeTab === 'calendars'}
        <SettingsCalendars />
      {:else if activeTab === 'templates'}
        <SettingsTemplates />
      {:else if activeTab === 'billing'}
        <SettingsBilling />
      {:else if activeTab === 'account'}
        <SettingsAccount />
      {:else if activeTab === 'privacy'}
        <SettingsPrivacy />
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .settings-layout {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: var(--space-8);
    max-width: 720px;

    @include mobile {
      grid-template-columns: 1fr;
      gap: var(--space-4);
    }
  }

  .settings-tabs {
    display: flex;
    flex-direction: column;
    gap: 1px;
    position: sticky;
    top: var(--space-8);
    align-self: start;

    @include mobile {
      flex-direction: row;
      overflow-x: auto;
      gap: 0;
      position: static;
      border-bottom: 1px solid var(--color-separator);
      padding-bottom: var(--space-2);
      -webkit-overflow-scrolling: touch;

      // Hide scrollbar
      &::-webkit-scrollbar {
        display: none;
      }
      scrollbar-width: none;
    }
  }

  .settings-tab {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font-family: $font-body;
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
    white-space: nowrap;
    text-align: left;
    width: 100%;

    :global(svg) {
      opacity: 0.5;
      flex-shrink: 0;
    }

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-hover);

      :global(svg) {
        opacity: 0.7;
      }
    }

    @include mobile {
      width: auto;
      flex-shrink: 0;
      border-radius: var(--radius-full);
      padding: var(--space-1) var(--space-3);
      font-size: 0.75rem;
    }
  }

  .settings-tab-active {
    color: var(--color-accent);
    background: var(--color-accent-muted);

    :global(svg) {
      opacity: 1;
    }

    &:hover {
      color: var(--color-accent);
      background: var(--color-accent-muted);

      :global(svg) {
        opacity: 1;
      }
    }
  }

  .settings-content {
    min-width: 0;
    max-width: 520px;
  }

  .settings-panel {
    animation: settingsEnter 200ms ease both;
  }

  @keyframes settingsEnter {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
