<script lang="ts">
  import { reveal } from '$lib/reveal';
  import { APP_URL, GITHUB_URL } from '$lib/config';
  import { PLAN_LIMITS, isUnlimited } from '@fluxure/shared';

  const free = PLAN_LIMITS.free;
  const pro = PLAN_LIMITS.pro;

  function limitLabel(value: number, singular: string, plural?: string): string {
    if (isUnlimited(value)) return `Unlimited ${plural ?? singular + 's'}`;
    return `Up to ${value} ${value === 1 ? singular : (plural ?? singular + 's')}`;
  }

  const plans = [
    {
      name: 'Self-Hosted',
      price: 'Free',
      period: 'forever',
      desc: 'Full control on your own infrastructure.',
      features: [
        'Unlimited habits & tasks',
        'Google Calendar sync',
        'All scheduling features',
        'Focus time protection',
        'Schedule quality score',
        'Natural language quick-add',
        'Public booking links',
        'Community support',
      ],
      cta: 'View on GitHub',
      href: GITHUB_URL,
      recommended: false,
    },
    {
      name: 'Cloud Free',
      price: '$0',
      period: '/mo',
      desc: 'Get started with zero setup.',
      features: [
        limitLabel(free.maxHabits, 'habit'),
        limitLabel(free.maxTasks, 'task'),
        'Google Calendar sync',
        `${free.schedulingWindowDays}-day scheduling window`,
        limitLabel(free.maxSchedulingLinks, 'booking link'),
        'Email support',
      ],
      cta: 'Get started free',
      href: `${APP_URL}/signup`,
      recommended: false,
    },
    {
      name: 'Cloud Pro',
      price: '$9',
      period: '/mo',
      desc: 'Managed hosting, unlimited everything.',
      features: [
        limitLabel(pro.maxHabits, 'habit'),
        limitLabel(pro.maxTasks, 'task'),
        `${pro.schedulingWindowDays}-day scheduling window`,
        pro.analyticsEnabled ? 'Advanced analytics' : 'Basic analytics',
        limitLabel(pro.maxSchedulingLinks, 'booking link'),
        `Up to ${pro.maxTemplates} scheduling templates`,
        pro.prioritySupport ? 'Priority support' : 'Email support',
      ],
      cta: 'Start free trial',
      href: `${APP_URL}/signup`,
      recommended: true,
    },
  ];
</script>

<svelte:head>
  <title>Pricing — Fluxure</title>
  <meta
    name="description"
    content="Simple, transparent pricing for Fluxure. Self-host free forever or use our managed cloud."
  />
  <meta property="og:title" content="Pricing — Fluxure" />
  <meta
    property="og:description"
    content="Simple, transparent pricing for Fluxure. Self-host free forever or use our managed cloud."
  />
  <meta property="og:url" content="https://fluxure.app/pricing" />
  <link rel="canonical" href="https://fluxure.app/pricing" />
</svelte:head>

<section class="page">
  <div class="header" use:reveal>
    <h1>Pricing</h1>
    <p>Start free. Self-host forever. Scale when you're ready.</p>
  </div>

  <div class="plans" use:reveal={{ delay: 100 }}>
    {#each plans as plan (plan.name)}
      <div class="plan" class:plan--rec={plan.recommended}>
        {#if plan.recommended}<span class="plan-badge">Recommended</span>{/if}
        <span class="plan-name">{plan.name}</span>
        <div class="plan-price">{plan.price}<span>{plan.period}</span></div>
        <p class="plan-desc">{plan.desc}</p>
        <ul class="plan-list">
          {#each plan.features as feat (feat)}<li>{feat}</li>{/each}
        </ul>
        <a
          class="plan-cta"
          class:plan-cta--fill={plan.recommended}
          href={plan.href}
          target={plan.href.startsWith('http') ? '_blank' : undefined}
          rel={plan.href.startsWith('http') ? 'noopener noreferrer' : undefined}>{plan.cta}</a
        >
      </div>
    {/each}
  </div>
</section>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .page {
    padding: 140px var(--space-6) 100px;
    max-width: 960px;
    margin: 0 auto;

    @include small {
      padding: 100px var(--space-4) 64px;
    }
  }

  .header {
    text-align: center;
    margin-bottom: var(--space-12);

    h1 {
      font-family: $font-heading;
      font-size: 2.25rem;
      font-weight: 400;
      line-height: 1.2;
      letter-spacing: -0.02em;
      margin-bottom: var(--space-3);

      @include mobile {
        font-size: 1.75rem;
      }
    }

    p {
      font-size: 1.0625rem;
      color: var(--color-text-secondary);
    }
  }

  .plans {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-6);

    @include tablet {
      grid-template-columns: 1fr;
      max-width: 400px;
      margin: 0 auto;
    }
  }

  .plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);

    &--rec {
      border-color: var(--color-accent);
    }
  }

  .plan-badge {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-accent);
  }

  .plan-name {
    font-family: $font-heading;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .plan-price {
    font-family: $font-heading;
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-text);
    line-height: 1;

    span {
      font-size: 0.8125rem;
      font-weight: 400;
      color: var(--color-text-tertiary);
    }
  }

  .plan-desc {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .plan-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;

    li {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      padding-left: 20px;
      position: relative;

      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 5px;
        width: 12px;
        height: 12px;
        background: var(--color-accent);
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'%3E%3Cpath d='M5 13l4 4L19 7'/%3E%3C/svg%3E")
          center / contain no-repeat;
      }
    }
  }

  .plan-cta {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: auto;
    padding-top: var(--space-4);
    height: 40px;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: var(--radius-md);
    text-decoration: none;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    background: transparent;

    &:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }

    &--fill {
      background: var(--color-accent);
      color: var(--color-accent-text);
      border-color: transparent;

      &:hover {
        background: var(--color-accent-hover);
        color: var(--color-accent-text);
      }
    }
  }
</style>
