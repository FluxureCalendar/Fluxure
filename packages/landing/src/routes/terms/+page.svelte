<script lang="ts">
  import { APP_NAME, SUPPORT_EMAIL } from '$lib/config';
</script>

<svelte:head>
  <title>Terms of Service - {APP_NAME}</title>
  <meta
    name="description"
    content="Terms of Service for {APP_NAME}, the intelligent calendar scheduling tool."
  />
</svelte:head>

<div class="legal-page">
  <div class="legal-content">
    <div class="legal-nav">
      <a href="/">
        <span class="brand-mark">{APP_NAME[0]}</span>
        <span class="brand-name">{APP_NAME}</span>
      </a>
    </div>

    <h1>Terms of Service</h1>
    <p class="legal-meta">Last updated: March 7, 2026</p>

    <section>
      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Fluxure ("the Service"), you agree to be bound by these Terms of
        Service. If you do not agree to these terms, you may not use the Service. These terms apply
        to all users, whether accessing the hosted version or a self-hosted instance.
      </p>
    </section>

    <section>
      <h2>2. Description of Service</h2>
      <p>
        Fluxure is an intelligent calendar scheduling tool that automatically places habits, tasks,
        meetings, and focus time on your calendar. The Service integrates with Google Calendar via
        the Google Calendar API to read your existing events and create optimized schedules using a
        scoring-based scheduling engine.
      </p>
      <p>The Service may include features such as:</p>
      <ul>
        <li>Automatic scheduling and rescheduling of recurring habits</li>
        <li>Task management with priority-based calendar placement</li>
        <li>Meeting coordination and buffer time management</li>
        <li>Focus time protection and analytics</li>
        <li>Real-time calendar synchronization</li>
      </ul>
    </section>

    <section>
      <h2>3. User Accounts</h2>
      <p>
        To use Fluxure, you must create an account and authenticate via Google OAuth. You are
        responsible for:
      </p>
      <ul>
        <li>Maintaining the security of your account credentials</li>
        <li>All activity that occurs under your account</li>
        <li>Notifying us immediately of any unauthorized use of your account</li>
      </ul>
      <p>
        Each account is intended for use by a single individual. You may not share your account
        credentials or allow multiple people to use a single account.
      </p>
    </section>

    <section>
      <h2>4. Google Calendar Integration</h2>
      <p>
        Fluxure accesses your Google Calendar data through Google's OAuth 2.0 authorization flow. By
        connecting your Google account, you grant Fluxure permission to:
      </p>
      <ul>
        <li>Read events from your connected calendars to identify scheduling constraints</li>
        <li>Create, update, and delete events that Fluxure manages on your behalf</li>
        <li>Use incremental sync to stay current with calendar changes</li>
      </ul>
      <p>
        You may revoke Fluxure's access to your Google Calendar at any time through your <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer">Google Account permissions</a
        > or through the Fluxure settings page. Revoking access will prevent Fluxure from reading or modifying
        your calendar data.
      </p>
    </section>

    <section>
      <h2>5. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in violation of any applicable laws</li>
        <li>Attempt to gain unauthorized access to the Service or its related systems</li>
        <li>
          Use automated scripts, bots, or scrapers to access or interact with the Service outside of
          its intended API
        </li>
        <li>Interfere with or disrupt the integrity or performance of the Service</li>
        <li>
          Reverse engineer, decompile, or disassemble any part of the Service (except where
          permitted by applicable law for self-hosted instances)
        </li>
        <li>Use the Service to send spam, phishing, or other unsolicited communications</li>
        <li>
          Impersonate any person or entity, or misrepresent your affiliation with any person or
          entity
        </li>
      </ul>
    </section>

    <section>
      <h2>6. Intellectual Property</h2>
      <p>
        The Service, including its source code, design, algorithms, documentation, and branding, is
        the intellectual property of Fluxure and is protected by applicable intellectual property
        laws.
      </p>
      <p>
        You retain full ownership of your data, including your calendar events, habits, tasks, and
        scheduling preferences. Fluxure claims no ownership rights over your content.
      </p>
    </section>

    <section>
      <h2>7. Data Privacy</h2>
      <p>
        Your privacy is important to us. Our collection and use of personal data is governed by our <a
          href="/privacy">Privacy Policy</a
        >, which is incorporated into these Terms by reference. By using the Service, you consent to
        the data practices described in the Privacy Policy.
      </p>
      <p>
        Fluxure is committed to compliance with the General Data Protection Regulation (GDPR) and
        other applicable data protection laws.
      </p>
    </section>

    <section>
      <h2>8. Service Availability</h2>
      <p>
        We strive to maintain high availability of the Service, but we do not guarantee
        uninterrupted or error-free operation. The Service may be temporarily unavailable due to:
      </p>
      <ul>
        <li>Scheduled maintenance and updates</li>
        <li>Unplanned outages or technical issues</li>
        <li>Third-party service disruptions (e.g., Google Calendar API)</li>
      </ul>
      <p>
        Self-hosted instances are operated entirely at your own risk and are not covered by any
        service level agreement. You are responsible for the maintenance, security, and availability
        of your self-hosted deployment.
      </p>
    </section>

    <section>
      <h2>9. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by applicable law, Fluxure and its operators shall not be
        liable for any indirect, incidental, special, consequential, or punitive damages, including
        but not limited to loss of profits, data, or use, arising out of or in connection with your
        use of the Service.
      </p>
      <p>
        Fluxure is not responsible for any missed appointments, scheduling conflicts, or calendar
        errors that may result from the use of the scheduling engine. You are responsible for
        reviewing and confirming all scheduled events on your calendar.
      </p>
    </section>

    <section>
      <h2>10. Termination</h2>
      <p>
        You may terminate your account at any time by deleting your account through the Settings
        page. Upon termination:
      </p>
      <ul>
        <li>All your data will be permanently deleted from our systems</li>
        <li>
          Fluxure-managed events on your Google Calendar will remain unless you manually remove them
        </li>
        <li>You may export your data before deletion via the data export feature</li>
      </ul>
      <p>
        We reserve the right to suspend or terminate your account if you violate these Terms, with
        reasonable notice where possible.
      </p>
    </section>

    <section>
      <h2>11. Changes to Terms</h2>
      <p>
        We may update these Terms of Service from time to time. When we make significant changes, we
        will notify you by email or through an in-app notification. Your continued use of the
        Service after such changes constitutes acceptance of the updated terms.
      </p>
      <p>We encourage you to review these terms periodically.</p>
    </section>

    <section>
      <h2>12. Governing Law</h2>
      <p>
        These Terms shall be governed by and construed in accordance with the laws of the State of
        Delaware, United States, without regard to its conflict of law provisions. Any disputes
        arising under these Terms shall be subject to the exclusive jurisdiction of the courts
        located in Delaware.
      </p>
    </section>

    <section>
      <h2>13. Contact</h2>
      <p>If you have any questions about these Terms of Service, please contact us at:</p>
      <p>
        <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>
      </p>
    </section>

    <div class="legal-footer">
      <a href="/">Back to home</a>
      <span class="legal-footer-sep">|</span>
      <a href="/privacy">Privacy Policy</a>
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .legal-page {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-bg);
  }

  .legal-content {
    max-width: 720px;
    width: 100%;
  }

  .legal-nav {
    margin-bottom: var(--space-8);

    a {
      display: inline-flex;
      align-items: center;
      gap: var(--space-3);
      text-decoration: none;
      color: var(--color-text);
    }
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-radius: var(--radius-md);
    font-weight: 700;
    font-size: 0.875rem;
  }

  .brand-name {
    font-size: 1.125rem;
    font-weight: 600;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-text);
    margin: 0 0 var(--space-2);
  }

  .legal-meta {
    font-size: 0.8125rem;
    color: var(--color-text-tertiary);
    margin: 0 0 var(--space-8);
  }

  section {
    margin-bottom: var(--space-6);
  }

  h2 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-3);
  }

  p {
    font-size: 0.875rem;
    line-height: 1.7;
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-3);

    a {
      color: var(--color-accent);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  ul {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-6);
  }

  li {
    font-size: 0.875rem;
    line-height: 1.7;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-1);
  }

  .legal-footer {
    margin-top: var(--space-10);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: var(--space-3);

    a {
      font-size: 0.8125rem;
      color: var(--color-accent);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  .legal-footer-sep {
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }
</style>
