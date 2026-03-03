<script lang="ts">
  import { onMount } from 'svelte';
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

  const qualityRadius = 28;
  const qualityCircumference = 2 * Math.PI * qualityRadius;
  let qualityDashoffset = $derived(
    qualityScore ? qualityCircumference * (1 - qualityScore.overall / 100) : qualityCircumference,
  );
</script>

{#if qualityScore}
  <button
    class="quality-badge"
    style="--quality-color: {qualityColor(qualityScore.overall)}"
    onclick={() => {
      qualityExpanded = !qualityExpanded;
    }}
    aria-label="Schedule quality: {qualityScore.overall}"
    aria-expanded={qualityExpanded}
  >
    <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r={qualityRadius}
        fill="none"
        stroke="var(--color-border)"
        stroke-width="5"
      />
      <circle
        cx="32"
        cy="32"
        r={qualityRadius}
        fill="none"
        stroke={qualityColor(qualityScore.overall)}
        stroke-width="5"
        stroke-linecap="round"
        stroke-dasharray={qualityCircumference}
        stroke-dashoffset={qualityDashoffset}
        transform="rotate(-90 32 32)"
        class="quality-ring"
      />
    </svg>
    <span class="quality-badge-value font-mono">{qualityScore.overall}</span>
  </button>
{/if}

<!-- Quality dropdown is rendered outside the header flow so it appears below -->
{#if qualityExpanded && qualityScore}
  <div class="quality-dropdown">
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
            class="quality-gauge-value font-mono"
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
              <span class="quality-comp-score font-mono">{comp.score}</span>
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

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .quality-badge {
    @include flex-center;
    gap: var(--space-1);
    padding: 2px 8px 2px 2px;
    height: 32px;
    border-radius: var(--radius-full);
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

  .quality-badge-value {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .quality-ring {
    @include ring-progress;
  }

  .quality-dropdown {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: var(--color-surface);
    animation: slideDown 150ms ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
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
