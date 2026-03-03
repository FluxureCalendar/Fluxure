<script lang="ts">
  import Calendar from 'lucide-svelte/icons/calendar';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Repeat from 'lucide-svelte/icons/repeat';
  import Layers from 'lucide-svelte/icons/layers';
  import Shield from 'lucide-svelte/icons/shield';
  import Link from 'lucide-svelte/icons/link';
  import BarChart from 'lucide-svelte/icons/bar-chart-3';
  import Smartphone from 'lucide-svelte/icons/smartphone';
  import Plug from 'lucide-svelte/icons/plug';
  import ListChecks from 'lucide-svelte/icons/list-checks';
  import Sparkles from 'lucide-svelte/icons/sparkles';
  import Check from 'lucide-svelte/icons/check';
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import Github from 'lucide-svelte/icons/github';
  import ArrowRight from 'lucide-svelte/icons/arrow-right';
  import type { Action } from 'svelte/action';
  import { APP_URL, GITHUB_URL } from '$lib/config';

  // Scroll-reveal Svelte action
  const reveal: Action<HTMLElement, { delay?: number; threshold?: number } | undefined> = (
    node,
    options,
  ) => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      node.classList.add('revealed');
      return {};
    }

    const delay = options?.delay ?? 0;
    const threshold = options?.threshold ?? 0.15;

    node.style.transitionDelay = delay ? `${delay}ms` : '';

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            node.classList.add('revealed');
            observer.unobserve(node);
          }
        }
      },
      { threshold },
    );

    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
      },
    };
  };

  const features = [
    {
      icon: Calendar,
      title: 'Auto-Scheduling',
      desc: 'AI places habits, tasks, and focus time in optimal slots based on your preferences and availability.',
    },
    {
      icon: RefreshCw,
      title: 'Google Calendar Sync',
      desc: 'Real-time bidirectional sync with automatic conflict detection and resolution.',
    },
    {
      icon: Repeat,
      title: 'Smart Habits',
      desc: 'Recurring habits with flexible frequency, ideal time preferences, and automatic rescheduling.',
    },
    {
      icon: Layers,
      title: 'Task Chunking',
      desc: 'Large tasks automatically split into manageable work sessions across your week.',
    },
    {
      icon: Shield,
      title: 'Focus Time Protection',
      desc: 'Dedicated deep work blocks that guard your concentration from meeting creep.',
    },
    {
      icon: Link,
      title: 'Scheduling Links',
      desc: 'Share your availability like Calendly, built right into your scheduling workflow.',
    },
    {
      icon: BarChart,
      title: 'Schedule Quality Score',
      desc: 'Daily health metrics for your calendar so you know how well-balanced your time is.',
    },
    {
      icon: Smartphone,
      title: 'Works Everywhere',
      desc: 'Progressive web app that works on any device. Install directly from your browser.',
    },
  ];

  const steps = [
    {
      num: '01',
      title: 'Connect',
      desc: 'Link your Google Calendar in one click with secure OAuth.',
      icon: Plug,
    },
    {
      num: '02',
      title: 'Define',
      desc: 'Add your habits, tasks, and time preferences.',
      icon: ListChecks,
    },
    {
      num: '03',
      title: 'Relax',
      desc: 'Fluxure handles the rest. Your calendar stays optimized.',
      icon: Sparkles,
    },
  ];

  const plans = [
    {
      name: 'Self-Hosted',
      price: 'Free',
      period: 'forever',
      desc: 'Full control, your infrastructure.',
      features: [
        'Unlimited habits & tasks',
        'Google Calendar sync',
        'All scheduling features',
        'Community support',
        'Open source',
      ],
      cta: 'Deploy Now',
      href: GITHUB_URL,
      highlighted: false,
    },
    {
      name: 'Pro',
      price: '$8',
      period: '/mo',
      desc: 'Managed hosting, zero maintenance.',
      features: [
        'Everything in Self-Hosted',
        'Managed cloud hosting',
        'Automatic backups',
        'Priority support',
        'Advanced analytics',
      ],
      cta: 'Start Free Trial',
      href: `${APP_URL}/signup`,
      highlighted: true,
    },
    {
      name: 'Team',
      price: '$15',
      period: '/user/mo',
      desc: 'Scheduling for your whole team.',
      features: [
        'Everything in Pro',
        'Team calendars',
        'Shared scheduling',
        'Admin dashboard',
        'SSO & SAML',
      ],
      cta: 'Contact Us',
      href: `${APP_URL}/signup`,
      highlighted: false,
    },
  ];

  const faqs = [
    {
      q: 'What is Fluxure?',
      a: 'Fluxure is a calendar scheduling tool that automatically places your habits, tasks, and focus time around your existing events. Think of it as an intelligent calendar assistant that ensures everything gets scheduled without conflicts.',
    },
    {
      q: 'How does auto-scheduling work?',
      a: 'Fluxure uses a greedy scheduling algorithm that scores candidate time slots based on your preferences, existing events, and priority levels. It continuously optimizes your schedule as things change throughout the day.',
    },
    {
      q: 'Is my data private?',
      a: 'Absolutely. When self-hosted, your data never leaves your server. Calendar tokens are encrypted with AES-256-GCM, and all communication happens over HTTPS. We have no access to your calendar data.',
    },
    {
      q: 'Can I self-host Fluxure?',
      a: 'Yes. Fluxure is fully open source and designed for self-hosting. Deploy with Docker in minutes. You get all features for free, forever, with no restrictions.',
    },
    {
      q: 'How does it compare to Reclaim.ai or Motion?',
      a: 'Fluxure is open source and self-hostable, so you own your data. It focuses on the core scheduling experience without vendor lock-in. The self-hosted version is free with no feature gates.',
    },
    {
      q: 'What calendars are supported?',
      a: 'Currently, Fluxure supports Google Calendar with full bidirectional sync. Support for Microsoft Outlook and CalDAV is on the roadmap.',
    },
  ];

  let openFaq = $state(-1);

  function toggleFaq(index: number) {
    openFaq = openFaq === index ? -1 : index;
  }
</script>

<!-- Hero -->
<section class="hero">
  <div class="hero-glow"></div>
  <div class="container hero-content">
    <h1 class="hero-entrance hero-entrance-1">Your calendar, intelligently managed</h1>
    <p class="hero-sub hero-entrance hero-entrance-2">
      Fluxure automatically schedules your habits, tasks, and focus time around your existing
      calendar. Stop manually juggling — let AI find the perfect slots.
    </p>
    <div class="hero-actions hero-entrance hero-entrance-3">
      <a class="btn btn-primary btn-lg" href="{APP_URL}/signup">
        Get Started Free
        <ArrowRight size={18} />
      </a>
      <a class="btn btn-outline btn-lg" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
        <Github size={18} />
        View on GitHub
      </a>
    </div>
    <p class="hero-trust hero-entrance hero-entrance-4">
      Free forever for self-hosted &middot; No credit card required
    </p>
  </div>
</section>

<!-- Features -->
<section class="section" id="features">
  <div class="container">
    <div class="section-header reveal" use:reveal>
      <h2>Everything you need to own your time</h2>
      <p>Powerful scheduling features that work together seamlessly.</p>
    </div>
    <div class="features-grid">
      {#each features as feature, i (feature.title)}
        <div class="feature-card reveal" use:reveal={{ delay: i * 75 }}>
          <div class="feature-icon">
            <feature.icon size={22} />
          </div>
          <h3>{feature.title}</h3>
          <p>{feature.desc}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- How It Works -->
<section class="section section-alt" id="how-it-works">
  <div class="container">
    <div class="section-header reveal" use:reveal>
      <h2>Up and running in minutes</h2>
      <p>Three steps to a smarter calendar.</p>
    </div>
    <div class="steps-grid">
      {#each steps as step, i (step.num)}
        <div class="step-card reveal" use:reveal={{ delay: i * 150 }}>
          <span class="step-num">{step.num}</span>
          <div class="step-icon">
            <step.icon size={24} />
          </div>
          <h3>{step.title}</h3>
          <p>{step.desc}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- Pricing -->
<section class="section" id="pricing">
  <div class="container">
    <div class="section-header reveal" use:reveal>
      <h2>Simple, transparent pricing</h2>
      <p>Start free. Scale when you're ready.</p>
    </div>
    <div class="pricing-grid">
      {#each plans as plan, i (plan.name)}
        <div
          class="pricing-card reveal-scale"
          class:highlighted={plan.highlighted}
          use:reveal={{ delay: i * 100 }}
        >
          {#if plan.highlighted}
            <span class="pricing-badge">Recommended</span>
          {/if}
          <h3>{plan.name}</h3>
          <div class="pricing-price">
            <span class="price-amount">{plan.price}</span>
            <span class="price-period">{plan.period}</span>
          </div>
          <p class="pricing-desc">{plan.desc}</p>
          <ul class="pricing-features">
            {#each plan.features as feat (feat)}
              <li><Check size={16} /> {feat}</li>
            {/each}
          </ul>
          <a
            class="btn {plan.highlighted ? 'btn-primary' : 'btn-outline'} btn-lg btn-full"
            href={plan.href}
            target={plan.href.startsWith('http') ? '_blank' : undefined}
            rel={plan.href.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {plan.cta}
          </a>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="section section-alt" id="faq">
  <div class="container container-narrow">
    <div class="section-header reveal" use:reveal>
      <h2>Frequently asked questions</h2>
      <p>Everything you need to know about Fluxure.</p>
    </div>
    <div class="faq-list">
      {#each faqs as faq, i (faq.q)}
        <div class="faq-item reveal" class:open={openFaq === i} use:reveal={{ delay: i * 60 }}>
          <button class="faq-trigger" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
            <span>{faq.q}</span>
            <ChevronDown size={18} />
          </button>
          <div class="faq-answer">
            <p>{faq.a}</p>
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>

<!-- CTA Banner -->
<section class="cta-banner">
  <div class="container reveal" use:reveal>
    <h2>Ready to take control of your time?</h2>
    <p>Join developers and professionals who trust Fluxure to manage their calendars.</p>
    <a class="btn btn-primary btn-lg cta-btn" href="{APP_URL}/signup">
      Get Started Free
      <ArrowRight size={18} />
    </a>
  </div>
</section>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  // ---- Scroll Reveal Animations ----
  .reveal {
    opacity: 0;
    transform: translateY(1.5rem);
    transition:
      opacity 0.6s var(--ease-out-expo),
      transform 0.6s var(--ease-out-expo);

    &:global(.revealed) {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .reveal-scale {
    opacity: 0;
    transform: scale(0.95) translateY(1rem);
    transition:
      opacity 0.5s var(--ease-out-expo),
      transform 0.5s var(--ease-out-expo);

    &:global(.revealed) {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal,
    .reveal-scale {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }

  // ---- Hero Entrance Animation ----
  .hero-entrance {
    opacity: 0;
    transform: translateY(1.25rem);
    animation: hero-enter 0.8s var(--ease-out-expo) forwards;
  }

  .hero-entrance-1 {
    animation-delay: 0.1s;
  }
  .hero-entrance-2 {
    animation-delay: 0.25s;
  }
  .hero-entrance-3 {
    animation-delay: 0.4s;
  }
  .hero-entrance-4 {
    animation-delay: 0.55s;
  }

  @keyframes hero-enter {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-entrance {
      opacity: 1;
      transform: none;
      animation: none;
    }
  }

  // ---- Shared ----
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 var(--space-6);
  }

  .container-narrow {
    max-width: 800px;
  }

  .section {
    padding: var(--space-24) 0;
  }

  .section-alt {
    background: var(--color-surface);
  }

  .section-header {
    text-align: center;
    margin-bottom: var(--space-16);

    h2 {
      font-size: 2rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 var(--space-3);
    }

    p {
      color: var(--color-text-secondary);
      font-size: 1.125rem;
      margin: 0;
    }
  }

  // ---- Buttons ----
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-family: $font-sans;
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
  }

  .btn-lg {
    padding: var(--space-3) var(--space-6);
    font-size: 0.9375rem;
    border-radius: var(--radius-lg);
  }

  .btn-full {
    width: 100%;
  }

  .btn-primary {
    background: var(--color-accent);
    color: var(--color-accent-text);

    &:hover {
      background: var(--color-accent-hover);
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);
    }
  }

  .btn-outline {
    background: transparent;
    border-color: var(--color-border-strong);
    color: var(--color-text);

    &:hover {
      background: var(--color-surface-hover);
      border-color: var(--color-text-tertiary);
    }
  }

  // ---- Hero ----
  .hero {
    position: relative;
    overflow: hidden;
    padding: var(--space-24) 0 var(--space-20);
    text-align: center;

    @include mobile {
      padding: var(--space-16) 0 var(--space-12);
    }
  }

  .hero-glow {
    position: absolute;
    top: -40%;
    left: 50%;
    transform: translateX(-50%);
    width: 800px;
    height: 600px;
    background: radial-gradient(ellipse at center, var(--color-accent-muted) 0%, transparent 70%);
    opacity: 0.6;
    pointer-events: none;
    will-change: transform, opacity;
    animation: glow-pulse 6s ease-in-out infinite alternate;
  }

  @keyframes glow-pulse {
    0% {
      opacity: 0.4;
      transform: translateX(-50%) scale(1);
    }
    50% {
      opacity: 0.65;
      transform: translateX(-50%) scale(1.05);
    }
    100% {
      opacity: 0.7;
      transform: translateX(-50%) scale(1.1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-glow {
      animation: none;
      opacity: 0.5;
    }
  }

  .hero-content {
    position: relative;

    h1 {
      font-size: 3.5rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin: 0 auto var(--space-6);
      max-width: 720px;

      @include tablet {
        font-size: 2.75rem;
      }

      @include mobile {
        font-size: 2.25rem;
      }

      @include small {
        font-size: 1.875rem;
      }
    }
  }

  .hero-sub {
    font-size: 1.25rem;
    line-height: 1.6;
    color: var(--color-text-secondary);
    max-width: 600px;
    margin: 0 auto var(--space-8);

    @include mobile {
      font-size: 1.0625rem;
    }
  }

  .hero-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .hero-trust {
    margin: var(--space-6) 0 0;
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
  }

  // ---- Features ----
  .features-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-6);

    @include tablet {
      grid-template-columns: repeat(2, 1fr);
    }

    @include small {
      grid-template-columns: 1fr;
    }
  }

  .feature-card {
    @include card;
    padding: var(--space-6);
    contain: content;
    transition:
      border-color var(--transition-base),
      box-shadow var(--transition-base),
      transform var(--transition-base),
      opacity 0.6s var(--ease-out-expo);

    @media (prefers-reduced-motion: no-preference) {
      &:hover {
        border-color: var(--color-border-strong);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        transform: translateY(-2px);
      }
    }

    h3 {
      font-size: 0.9375rem;
      font-weight: 600;
      margin: var(--space-4) 0 var(--space-2);
    }

    p {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      line-height: 1.6;
      margin: 0;
    }
  }

  .feature-icon {
    width: 40px;
    height: 40px;
    @include flex-center;
    background: var(--color-accent-muted);
    color: var(--color-accent);
    border-radius: var(--radius-lg);
    transition: transform var(--transition-base);

    .feature-card:hover & {
      transform: scale(1.1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .feature-icon {
      transition: none;
    }
    .feature-card:hover .feature-icon {
      transform: none;
    }
  }

  // ---- Steps ----
  .steps-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-8);

    @include mobile {
      grid-template-columns: 1fr;
      gap: var(--space-6);
    }
  }

  .step-card {
    text-align: center;
    padding: var(--space-8) var(--space-6);

    h3 {
      font-size: 1.125rem;
      font-weight: 600;
      margin: var(--space-4) 0 var(--space-2);
    }

    p {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin: 0;
      line-height: 1.6;
    }
  }

  .step-num {
    font-family: $font-mono;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-accent);
    letter-spacing: 0.05em;
  }

  .step-icon {
    width: 56px;
    height: 56px;
    @include flex-center;
    background: var(--color-accent-muted);
    color: var(--color-accent);
    border-radius: var(--radius-xl);
    margin: var(--space-4) auto 0;
  }

  // ---- Pricing ----
  .pricing-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-6);
    align-items: start;

    @include tablet {
      grid-template-columns: 1fr;
      max-width: 480px;
      margin: 0 auto;
    }
  }

  .pricing-card {
    @include card;
    padding: var(--space-8);
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: visible;
    transition:
      transform var(--transition-base),
      box-shadow var(--transition-base),
      border-color var(--transition-base),
      opacity 0.5s var(--ease-out-expo);

    @media (prefers-reduced-motion: no-preference) {
      &:hover {
        transform: translateY(-3px);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
      }
    }

    &.highlighted {
      border-color: var(--color-accent);
      box-shadow:
        0 0 0 1px var(--color-accent),
        0 0 24px rgba(99, 102, 241, 0.12);
    }

    h3 {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0 0 var(--space-4);
    }
  }

  .pricing-badge {
    position: absolute;
    top: calc(-1 * var(--space-3));
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: 0.75rem;
    font-weight: 600;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    white-space: nowrap;
    animation: badge-shimmer 3s ease-in-out infinite;
  }

  @keyframes badge-shimmer {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
    }
    50% {
      box-shadow: 0 0 12px 2px rgba(99, 102, 241, 0.35);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pricing-badge {
      animation: none;
    }
    .pricing-card:hover {
      transform: none;
    }
  }

  .pricing-price {
    margin-bottom: var(--space-4);
  }

  .price-amount {
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .price-period {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .pricing-desc {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-6);
  }

  .pricing-features {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-8);
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);

    li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.875rem;
      color: var(--color-text-secondary);

      :global(svg) {
        color: var(--color-success);
        flex-shrink: 0;
      }
    }
  }

  // ---- FAQ ----
  .faq-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .faq-item {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-bg);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);

    &.open {
      background: color-mix(in srgb, var(--color-bg) 97%, var(--color-accent));
      border-color: var(--color-border-strong);
    }

    &.open .faq-trigger :global(svg) {
      transform: rotate(180deg);
    }

    &.open .faq-answer {
      grid-template-rows: 1fr;
    }
  }

  .faq-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    background: none;
    border: none;
    font-family: $font-sans;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
    gap: var(--space-4);
    min-height: 44px;

    :global(svg) {
      color: var(--color-text-tertiary);
      flex-shrink: 0;
      transition: transform var(--transition-base);
    }

    &:hover {
      color: var(--color-accent);
    }
  }

  .faq-answer {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--transition-slow) var(--ease-spring);

    p {
      overflow: hidden;
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      line-height: 1.7;
      margin: 0;
      padding: 0 var(--space-5) var(--space-4);
    }
  }

  // ---- CTA Banner ----
  .cta-banner {
    padding: var(--space-24) 0;
    text-align: center;
    position: relative;
    overflow: hidden;

    &::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 600px;
      height: 400px;
      background: radial-gradient(ellipse at center, var(--color-accent-muted) 0%, transparent 70%);
      opacity: 0.5;
      pointer-events: none;
      animation: cta-glow 5s ease-in-out infinite alternate;
    }

    .container {
      position: relative;
    }

    h2 {
      font-size: 2rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 var(--space-3);

      @include mobile {
        font-size: 1.5rem;
      }
    }

    p {
      color: var(--color-text-secondary);
      font-size: 1.0625rem;
      margin: 0 0 var(--space-8);
    }
  }

  @keyframes cta-glow {
    0% {
      opacity: 0.3;
      transform: translate(-50%, -50%) scale(1);
    }
    100% {
      opacity: 0.6;
      transform: translate(-50%, -50%) scale(1.15);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cta-banner::before {
      animation: none;
      opacity: 0.4;
    }
  }

  .cta-btn:hover {
    box-shadow: 0 0 24px rgba(99, 102, 241, 0.35);
  }

  // ---- Dark mode shadow adjustments ----
  @media (prefers-color-scheme: dark) {
    .feature-card:hover {
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }

    .pricing-card:hover {
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
    }

    .pricing-card.highlighted {
      box-shadow:
        0 0 0 1px var(--color-accent),
        0 0 32px rgba(129, 140, 248, 0.15);
    }

    .btn-primary:hover {
      box-shadow: 0 0 20px rgba(129, 140, 248, 0.35);
    }

    .cta-btn:hover {
      box-shadow: 0 0 24px rgba(129, 140, 248, 0.4);
    }

    .pricing-badge {
      animation-name: badge-shimmer-dark;
    }

    @keyframes badge-shimmer-dark {
      0%,
      100% {
        box-shadow: 0 0 0 0 rgba(129, 140, 248, 0);
      }
      50% {
        box-shadow: 0 0 14px 2px rgba(129, 140, 248, 0.4);
      }
    }
  }
</style>
