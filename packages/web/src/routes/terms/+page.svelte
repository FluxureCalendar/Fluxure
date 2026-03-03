<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>{pageTitle('Terms of Service')}</title>
</svelte:head>

<div class="terms-page">
  <div class="terms-card">
    <div class="terms-header">
      <a href={resolve('/')} class="terms-brand">
        <span class="sidebar-logo">F</span>
        <span class="terms-brand-name">Fluxure</span>
      </a>
    </div>

    <h1>Terms of Service</h1>
    <p class="terms-updated">Last updated: March 7, 2026</p>

    <section>
      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Fluxure ("the Service"), you agree to be bound by these Terms of
        Service. If you do not agree to these terms, you may not use the Service. We may update
        these terms from time to time, and your continued use of the Service constitutes acceptance
        of any changes.
      </p>
    </section>

    <section>
      <h2>2. Description of Service</h2>
      <p>
        Fluxure is a calendar scheduling application that automatically places habits, tasks,
        meetings, and focus time on your Google Calendar. The Service analyzes your calendar
        availability and uses a scheduling engine to find optimal times for your scheduled items.
      </p>
      <p>
        The Service requires a Google account and access to Google Calendar to function. Features
        may be added, modified, or removed at any time without prior notice.
      </p>
    </section>

    <section>
      <h2>3. User Accounts</h2>
      <ul>
        <li>You must provide accurate and complete information when creating an account.</li>
        <li>You are responsible for maintaining the security of your account credentials.</li>
        <li>You must notify us immediately of any unauthorized use of your account.</li>
        <li>One person or entity may not maintain more than one account.</li>
        <li>You must be at least 16 years of age to use the Service.</li>
      </ul>
    </section>

    <section>
      <h2>4. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
        <li>
          Attempt to gain unauthorized access to the Service, other accounts, or connected systems.
        </li>
        <li>Interfere with or disrupt the integrity or performance of the Service.</li>
        <li>Reverse engineer, decompile, or disassemble any part of the Service.</li>
        <li>Use automated means (bots, scrapers) to access the Service beyond its intended API.</li>
        <li>
          Resell, redistribute, or sublicense access to the Service without written permission.
        </li>
      </ul>
    </section>

    <section>
      <h2>5. Google Calendar Integration</h2>
      <p>
        The Service accesses your Google Calendar data to read existing events and create scheduled
        items. By connecting your Google account, you authorize Fluxure to read and write calendar
        events on your behalf. You may revoke this access at any time through your Google Account
        settings or the Fluxure settings page.
      </p>
      <p>
        Fluxure's use of Google user data complies with the <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer">Google API Services User Data Policy</a
        >, including the Limited Use requirements.
      </p>
    </section>

    <section>
      <h2>6. Intellectual Property</h2>
      <p>
        The Service and its original content, features, and functionality are owned by Fluxure and
        are protected by copyright, trademark, and other intellectual property laws. You retain
        ownership of any data you input into the Service (habits, tasks, meeting details, etc.).
      </p>
    </section>

    <section>
      <h2>7. Limitation of Liability</h2>
      <p>
        The Service is provided on an "as is" and "as available" basis without warranties of any
        kind, whether express or implied. Fluxure does not warrant that the Service will be
        uninterrupted, error-free, or secure.
      </p>
      <p>
        In no event shall Fluxure be liable for any indirect, incidental, special, consequential, or
        punitive damages, including but not limited to loss of data, missed appointments, scheduling
        conflicts, or business interruption, arising out of or in connection with your use of the
        Service.
      </p>
    </section>

    <section>
      <h2>8. Termination</h2>
      <p>
        You may terminate your account at any time by deleting it from the Settings page. Upon
        termination, all your data will be permanently deleted. We reserve the right to suspend or
        terminate your access to the Service at any time for violation of these terms, without prior
        notice or liability.
      </p>
    </section>

    <section>
      <h2>9. Changes to Terms</h2>
      <p>
        We reserve the right to modify these terms at any time. Material changes will be
        communicated via email or in-app notification at least 14 days before they take effect. Your
        continued use of the Service after changes become effective constitutes acceptance of the
        revised terms.
      </p>
    </section>

    <section>
      <h2>10. Governing Law</h2>
      <p>
        These terms shall be governed by and construed in accordance with applicable laws, without
        regard to conflict of law principles. Any disputes arising from these terms or the Service
        shall be resolved through good-faith negotiation before pursuing formal legal proceedings.
      </p>
    </section>

    <section>
      <h2>11. Contact</h2>
      <p>
        For questions about these Terms of Service, please contact us at the email address provided
        in your account settings.
      </p>
    </section>

    <div class="terms-footer">
      <a href={resolve('/settings')}>Back to Settings</a>
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .terms-page {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-bg);
  }

  .terms-card {
    max-width: 680px;
    width: 100%;
  }

  .terms-header {
    margin-bottom: var(--space-8);
  }

  .terms-brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    text-decoration: none;
    color: var(--color-text);
  }

  .terms-brand-name {
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

  .terms-updated {
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

  a {
    color: var(--color-accent);
  }

  .terms-footer {
    margin-top: var(--space-10);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);

    a {
      font-size: 0.8125rem;
      color: var(--color-accent);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
</style>
