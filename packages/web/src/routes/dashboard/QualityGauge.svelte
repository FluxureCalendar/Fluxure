<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { schedule } from '$lib/api';

  interface QualityData {
    overall: number;
    components: {
      placement: { score: number; weight: number; label: string };
      idealTime: { score: number; weight: number; label: string };
      focusTime: { score: number; weight: number; label: string };
      buffers: { score: number; weight: number; label: string };
      priorities: { score: number; weight: number; label: string };
    };
    breakdown: string[];
  }

  let qualityScore = $state<QualityData | null>(null);
  let qualityExpanded = $state(false);

  function qualityColor(score: number): string {
    if (score >= 90) return 'var(--color-success)';
    if (score >= 70) return 'var(--color-accent)';
    if (score >= 50) return 'var(--color-warning-amber)';
    return 'var(--color-danger)';
  }

  function qualityLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Poor';
  }

  async function fetchQuality() {
    try {
      qualityScore = await schedule.getQuality();
    } catch {
      // Quality is non-critical; silently ignore errors
    }
  }

  onMount(() => {
    fetchQuality();
  });

  // Ring math for the expanded dropdown gauge
  const qualityCircumference = 2 * Math.PI * 30;
</script>

{#if qualityScore}
  <div class="quality-container">
    <button
      class="quality-badge"
      style="--quality-color: {qualityColor(qualityScore.overall)}"
      onclick={() => {
        qualityExpanded = !qualityExpanded;
      }}
      aria-label="Schedule quality: {qualityScore.overall}"
      aria-expanded={qualityExpanded}
    >
      <span class="quality-dot" style="background: {qualityColor(qualityScore.overall)}"></span>
      <span class="quality-badge-value">{qualityScore.overall}</span>
      <span class="quality-badge-label">{qualityLabel(qualityScore.overall)}</span>
    </button>

    {#if qualityExpanded}
      <div class="quality-dropdown" transition:fly={{ y: -8, duration: 150 }}>
        <div class="quality-header-row">
          <div class="quality-gauge">
            <svg
              width="72"
              height="72"
              viewBox="0 0 72 72"
              role="img"
              aria-label="Quality score: {qualityScore.overall}"
            >
              <circle
                cx="36"
                cy="36"
                r="30"
                fill="none"
                stroke="var(--color-border)"
                stroke-width="5"
              />
              <circle
                cx="36"
                cy="36"
                r="30"
                fill="none"
                stroke={qualityColor(qualityScore.overall)}
                stroke-width="5"
                stroke-linecap="round"
                stroke-dasharray={2 * Math.PI * 30}
                stroke-dashoffset={2 * Math.PI * 30 * (1 - qualityScore.overall / 100)}
                transform="rotate(-90 36 36)"
                class="quality-ring"
              />
              <text
                x="36"
                y="34"
                text-anchor="middle"
                class="quality-gauge-value"
                dominant-baseline="central"
              >
                {qualityScore.overall}
              </text>
              <text x="36" y="50" text-anchor="middle" class="quality-gauge-label">
                {qualityLabel(qualityScore.overall)}
              </text>
            </svg>
          </div>
          <div class="quality-components">
            {#if qualityScore?.components}
              {#each Object.values(qualityScore.components) as comp (comp.label)}
                <div class="quality-comp-row">
                  <span class="quality-comp-label">{comp.label}</span>
                  <div class="quality-comp-bar-track">
                    <div
                      class="quality-comp-bar-fill"
                      style="width: {comp.score}%; background: {qualityColor(comp.score)}"
                    ></div>
                  </div>
                  <span class="quality-comp-score">{comp.score}</span>
                </div>
              {/each}
            {/if}
          </div>
        </div>
        {#if qualityScore.breakdown.length > 0}
          <ul class="quality-breakdown">
            {#each qualityScore.breakdown as note, noteIdx (noteIdx)}
              <li>{note}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style lang="scss">
  @use '$lib/styles/variables' as *;
  @use '$lib/styles/mixins' as *;

  .quality-container {
    position: relative;
  }

  .quality-badge {
    @include flex-center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast);

    &:hover {
      border-color: var(--quality-color);
      background: var(--color-surface-hover);
    }
  }

  .quality-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .quality-badge-value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    font-family: $font-body;
  }

  .quality-badge-label {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    font-family: $font-body;
  }

  .quality-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: var(--space-2);
    width: 360px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: var(--color-surface);
    box-shadow: var(--shadow-lg);
    z-index: 50;
  }

  .quality-header-row {
    display: flex;
    gap: var(--space-6);
    align-items: center;
  }

  .quality-gauge {
    flex-shrink: 0;
  }

  .quality-gauge-value {
    font-size: 18px;
    font-weight: 700;
    fill: var(--color-text);
  }

  .quality-gauge-label {
    font-size: 9px;
    fill: var(--color-text-secondary);
  }

  .quality-components {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .quality-comp-row {
    display: grid;
    grid-template-columns: 120px 1fr 32px;
    gap: var(--space-2);
    align-items: center;
  }

  .quality-comp-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .quality-comp-bar-track {
    height: 6px;
    background: var(--color-surface-hover);
    border-radius: 3px;
    overflow: hidden;
  }

  .quality-comp-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width var(--transition-base);
  }

  .quality-comp-score {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text);
    text-align: right;
  }

  .quality-breakdown {
    margin: var(--space-3) 0 0 0;
    padding: var(--space-3) 0 0 0;
    border-top: 1px solid var(--color-border);
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);

    li {
      font-size: 0.75rem;
      color: var(--color-text-tertiary);

      &::before {
        content: '\2022';
        margin-right: var(--space-1);
        color: var(--color-text-tertiary);
      }
    }
  }
</style>
