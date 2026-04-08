<script lang="ts">
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import { reveal } from '$lib/reveal';
  import { APP_URL, GITHUB_URL } from '$lib/config';

  const features = [
    {
      title: 'Intelligent scheduling',
      desc: 'Finds optimal time slots for habits, tasks, and focus blocks. Respects your preferences and energy.',
    },
    {
      title: 'Real-time sync',
      desc: 'Bidirectional Google Calendar sync. Your schedule stays current as things change.',
    },
    {
      title: 'Focus protection',
      desc: 'Deep work blocks that guard your concentration. Schedules around them, not through them.',
    },
    {
      title: 'Open source',
      desc: 'Self-hostable with Docker. Full control over your data, no vendor lock-in.',
    },
  ];

  const steps = [
    { n: '1', title: 'Connect', desc: 'Link Google Calendar with one click.' },
    { n: '2', title: 'Define', desc: 'Add habits, tasks, and preferences.' },
    { n: '3', title: 'Flow', desc: 'Your schedule optimizes itself.' },
  ];

  const plans = [
    {
      name: 'Self-Hosted',
      price: 'Free',
      period: 'forever',
      desc: 'Your infrastructure, full control.',
      features: [
        'Unlimited habits & tasks',
        'Google Calendar sync',
        'All scheduling features',
        'Focus time protection',
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
      desc: 'Zero setup, get started now.',
      features: [
        'Up to 3 habits',
        'Up to 5 tasks',
        'Google Calendar sync',
        'Basic scheduling',
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
      desc: 'Unlimited everything, managed.',
      features: [
        'Unlimited habits & tasks',
        'Priority scheduling',
        'Advanced analytics',
        'Automatic backups',
        'Priority support',
      ],
      cta: 'Start free trial',
      href: `${APP_URL}/signup`,
      recommended: true,
    },
  ];

  const faqs = [
    {
      q: 'What is Fluxure?',
      a: 'A calendar tool that automatically places habits, tasks, and focus time around your existing events. A calm, intelligent scheduling assistant.',
    },
    {
      q: 'How does scheduling work?',
      a: 'Fluxure scores time slots based on your preferences, existing events, and priorities. It optimizes continuously as things change.',
    },
    {
      q: 'Is my data private?',
      a: 'Self-hosted: your data never leaves your server. Cloud: tokens encrypted with AES-256-GCM, all communication over HTTPS.',
    },
    {
      q: 'Can I self-host?',
      a: 'Yes. Fully open source, deploy with Docker in minutes. All features, free, forever.',
    },
    {
      q: 'What calendars are supported?',
      a: 'Google Calendar with full bidirectional sync. Outlook and CalDAV are on the roadmap.',
    },
  ];

  let openFaq = $state(-1);

  function toggleFaq(i: number) {
    openFaq = openFaq === i ? -1 : i;
  }
</script>

<section class="hero">
  <svg class="ripple" viewBox="0 0 400 400" aria-hidden="true">
    <circle cx="200" cy="200" r="160" />
    <circle cx="200" cy="200" r="160" style="animation-delay: 1.5s" />
    <circle cx="200" cy="200" r="160" style="animation-delay: 3s" />
    <circle cx="200" cy="200" r="160" style="animation-delay: 4.5s" />
  </svg>
  <div class="hero-content">
    <p class="hero-tag">Calendar scheduling, simplified</p>
    <h1 class="hero-heading">Your time, flowing naturally</h1>
    <p class="hero-sub">
      Fluxure schedules habits, tasks, and focus time around your existing events. No juggling. Just
      rhythm.
    </p>
    <a class="btn-primary" href="{APP_URL}/signup">Start for free</a>
  </div>
</section>

<section class="section" id="features" use:reveal>
  <h2 class="section-heading">What it does</h2>
  <div class="features">
    {#each features as f, i (f.title)}
      <div class="feature" use:reveal={{ delay: i * 80 }}>
        <h3>{f.title}</h3>
        <p>{f.desc}</p>
      </div>
    {/each}
  </div>
</section>

<section class="section" use:reveal>
  <h2 class="section-heading">How it works</h2>
  <div class="steps">
    {#each steps as s (s.n)}
      <div class="step" use:reveal={{ delay: Number(s.n) * 80 }}>
        <span class="step-n">{s.n}</span>
        <h3>{s.title}</h3>
        <p>{s.desc}</p>
      </div>
    {/each}
  </div>
</section>

<section class="section" id="pricing" use:reveal>
  <h2 class="section-heading">Pricing</h2>
  <div class="plans">
    {#each plans as plan (plan.name)}
      <div class="plan" class:plan--rec={plan.recommended} use:reveal={{ delay: 80 }}>
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

<section class="section" id="faq" use:reveal>
  <h2 class="section-heading">Questions</h2>
  <div class="faq">
    {#each faqs as faq, i (faq.q)}
      <button class="faq-row" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
        <div class="faq-q">
          <span>{faq.q}</span>
          <ChevronDown size={16} class="faq-icon {openFaq === i ? 'open' : ''}" />
        </div>
        {#if openFaq === i}
          <p class="faq-a">{faq.a}</p>
        {/if}
      </button>
    {/each}
  </div>
</section>

<section class="cta" use:reveal>
  <h2 class="cta-heading">Find your flow</h2>
  <a class="btn-primary" href="{APP_URL}/signup">Get started free</a>
</section>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  /* ---- Ripple ---- */

  .ripple {
    position: absolute;
    width: min(600px, 90vw);
    aspect-ratio: 1;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;

    circle {
      fill: none;
      stroke: var(--color-accent);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      transform-origin: 200px 200px;
      animation: ripple 6s var(--ease-calm) infinite backwards;
    }
  }

  /* ---- Features ---- */

  .features {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-12) var(--space-10);
    margin-top: var(--space-10);

    @include mobile {
      grid-template-columns: 1fr;
      gap: var(--space-8);
    }
  }

  .feature {
    h3 {
      font-family: $font-heading;
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: var(--space-2);
    }

    p {
      font-size: 0.9375rem;
      color: var(--color-text-secondary);
      line-height: 1.65;
      max-width: 320px;
    }
  }

  /* ---- Steps ---- */

  .steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-10);
    margin-top: var(--space-10);

    @include mobile {
      grid-template-columns: 1fr;
      gap: var(--space-8);
    }
  }

  .step {
    .step-n {
      display: block;
      font-family: $font-heading;
      font-size: 2rem;
      font-weight: 300;
      color: var(--color-accent);
      line-height: 1;
      margin-bottom: var(--space-3);
    }

    h3 {
      font-family: $font-heading;
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: var(--space-1);
    }

    p {
      font-size: 0.9375rem;
      color: var(--color-text-secondary);
      line-height: 1.6;
    }
  }

  /* ---- Pricing ---- */

  .plans {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-6);
    margin-top: var(--space-10);

    @include tablet {
      grid-template-columns: 1fr;
      max-width: 400px;
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

  /* ---- FAQ ---- */

  .faq {
    display: flex;
    flex-direction: column;
    margin-top: var(--space-8);
    border-top: 1px solid var(--color-border);
  }

  .faq-row {
    display: block;
    width: 100%;
    padding: var(--space-5) 0;
    background: none;
    border: none;
    border-bottom: 1px solid var(--color-border);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }

  .faq-q {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-text);
    transition: color var(--transition-fast);

    .faq-row:hover & {
      color: var(--color-accent);
    }
  }

  :global(.faq-icon) {
    color: var(--color-text-tertiary);
    transition: transform var(--transition-base);
    flex-shrink: 0;
  }

  :global(.faq-icon.open) {
    transform: rotate(180deg);
  }

  .faq-a {
    margin-top: var(--space-3);
    font-size: 0.9375rem;
    color: var(--color-text-secondary);
    line-height: 1.65;
    max-width: 520px;
    animation: calmEnter 200ms var(--ease-calm) both;
  }
</style>
