<script lang="ts">
  import { onMount } from 'svelte';
  import { pageTitle } from '$lib/brand';
  import { analytics, schedule } from '$lib/api';
  import type { AnalyticsData, QualityScore } from '@fluxure/shared';
  import { SvelteDate } from 'svelte/reactivity';
  import { formatDuration } from '$lib/utils/format';

  import PageHeader from '$lib/components/PageHeader.svelte';

  let data = $state<AnalyticsData | null>(null);
  let quality = $state<QualityScore | null>(null);
  let qualityTrend = $state<QualityScore[]>([]);
  let loading = $state(true);
  let loadError = $state('');

  async function loadData() {
    try {
      const now = new SvelteDate();
      const from = new SvelteDate(now);
      from.setDate(from.getDate() - 7);

      loadError = '';
      const [analyticsData, qualityData, trendData] = await Promise.all([
        analytics.get(from.toISOString(), now.toISOString()),
        schedule.getQuality().catch(() => null),
        schedule
          .getQualityRange(from.toISOString().slice(0, 10), now.toISOString().slice(0, 10))
          .catch(() => []),
      ]);

      data = analyticsData;
      quality = qualityData;
      qualityTrend = trendData;
    } catch {
      loadError = 'Failed to load analytics. Please try again.';
    } finally {
      loading = false;
    }
  }

  let maxTrendScore = $derived(
    qualityTrend.length > 0 ? Math.max(...qualityTrend.map((q) => q.overall), 1) : 100,
  );

  onMount(() => {
    loadData();
  });
</script>

<svelte:head>
  <title>{pageTitle('Analytics')}</title>
</svelte:head>

<PageHeader title="Analytics" subtitle="See how your time is spent across the week" />

{#if !loading}
  {#if loadError}
    <div class="load-error">
      <p>{loadError}</p>
      <button onclick={loadData}>Retry</button>
    </div>
  {:else}
    <div class="analytics-layout content-enter">
      <!-- Quality score — large and prominent -->
      <div class="quality-hero">
        <span
          class="quality-number"
          class:quality-good={quality !== null && quality.overall >= 80}
          class:quality-fair={quality !== null && quality.overall >= 50 && quality.overall < 80}
          class:quality-poor={quality !== null && quality.overall < 50}
          >{quality ? Math.round(quality.overall) : '--'}</span
        >
        <span class="quality-out-of">/100</span>
        <p class="quality-subtitle">Schedule quality score</p>
      </div>

      <!-- KPI cards -->
      {#if data}
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">Habit time</span>
            <span class="kpi-value">{formatDuration(data.habitMinutes)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Task time</span>
            <span class="kpi-value">{formatDuration(data.taskMinutes)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Meeting time</span>
            <span class="kpi-value">{formatDuration(data.meetingMinutes)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Focus time</span>
            <span class="kpi-value">{formatDuration(data.focusMinutes)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Habit completion</span>
            <span class="kpi-value">{Math.round(data.habitCompletionRate * 100)}%</span>
          </div>
        </div>
      {/if}

      <!-- 7-day quality trend -->
      {#if qualityTrend.length > 0}
        <div class="trend-section">
          <h3>7-day trend</h3>
          <div class="trend-bars">
            {#each qualityTrend as q, i (i)}
              <div class="trend-col">
                <div class="trend-bar-wrapper">
                  <div class="trend-bar" style:height="{(q.overall / maxTrendScore) * 100}%"></div>
                </div>
                <span class="trend-label">
                  {new SvelteDate(
                    new SvelteDate().getTime() - (qualityTrend.length - 1 - i) * 86400000,
                  ).toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Quality components breakdown -->
      {#if quality}
        <div class="components-section">
          <h3>Quality breakdown</h3>
          <div class="components-list">
            {#each Object.values(quality.components) as comp (comp.label)}
              <div class="component-row">
                <span class="component-label">{comp.label}</span>
                <div class="component-bar-track">
                  <div class="component-bar-fill" style:width="{comp.score}%"></div>
                </div>
                <span class="component-score">{Math.round(comp.score)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .analytics-layout {
    @include flex-col(var(--space-10));
    max-width: 640px;
  }

  // Quality hero — the number IS the page
  .quality-hero {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .quality-number {
    font-family: $font-heading;
    font-weight: 600;
    font-size: 5rem;
    line-height: 1;
    color: var(--color-text);
    letter-spacing: -0.03em;

    &.quality-good {
      color: var(--color-success);
    }
    &.quality-fair {
      color: var(--color-warning);
    }
    &.quality-poor {
      color: var(--color-danger);
    }
  }

  .quality-out-of {
    font-size: 1.25rem;
    color: var(--color-text-tertiary);
    opacity: 0.4;
  }

  .quality-subtitle {
    width: 100%;
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin-top: var(--space-1);
  }

  // KPI — just numbers in a row, no cards
  .kpi-grid {
    display: flex;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  .kpi-card {
    @include flex-col(2px);
    border-left: 2px solid var(--color-accent);
    padding-left: var(--space-3);
  }

  .kpi-label {
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.03em;
    color: var(--color-text-tertiary);
    opacity: 0.6;
  }

  .kpi-value {
    font-family: $font-heading;
    font-weight: 600;
    font-size: 1.125rem;
    color: var(--color-text);
  }

  // Trend bars — thin, quiet
  .trend-section {
    h3 {
      @include section-label;
      margin-bottom: var(--space-3);
    }
  }

  .trend-bars {
    display: flex;
    gap: var(--space-2);
    align-items: flex-end;
    height: 80px;
  }

  .trend-col {
    flex: 1;
    @include flex-col;
    align-items: center;
    height: 100%;
  }

  .trend-bar-wrapper {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .trend-bar {
    width: 100%;
    max-width: 32px;
    background: var(--color-accent);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    min-height: 2px;
    opacity: 0.6;
  }

  .trend-label {
    font-size: 0.625rem;
    color: var(--color-text-tertiary);
    margin-top: var(--space-1);
    opacity: 0.5;
  }

  // Components breakdown — clean bars
  .components-section {
    h3 {
      @include section-label;
      margin-bottom: var(--space-3);
    }
  }

  .components-list {
    @include flex-col(var(--space-3));
  }

  .component-row {
    display: grid;
    grid-template-columns: 100px 1fr 32px;
    align-items: center;
    gap: var(--space-3);
  }

  .component-label {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  .component-bar-track {
    height: 4px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .component-bar-fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: var(--radius-full);
    opacity: 0.7;
  }

  .component-score {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    text-align: right;
  }
</style>
