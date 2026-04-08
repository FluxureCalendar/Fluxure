<script lang="ts">
  import { APP_NAME, PRIVACY_EMAIL } from '$lib/config';
</script>

<svelte:head>
  <title>Privacy Policy — {APP_NAME}</title>
  <meta
    name="description"
    content="Privacy Policy for {APP_NAME}, the intelligent calendar scheduling tool."
  />
  <meta property="og:title" content="Privacy Policy — Fluxure" />
  <meta
    property="og:description"
    content="Privacy Policy for Fluxure, the intelligent calendar scheduling tool."
  />
  <link rel="canonical" href="https://fluxure.app/privacy" />
</svelte:head>

<div class="legal-page">
  <div class="legal-content">
    <div class="legal-nav">
      <a href="/">
        <img src="/logo-mark.svg" alt="" width="24" height="24" />
        <span class="legal-brand-name">fluxure</span>
      </a>
    </div>

    <h1>Privacy Policy</h1>
    <p class="legal-meta">Last updated: March 7, 2026</p>

    <section>
      <h2>1. Information We Collect</h2>
      <p>We collect and process the following types of information when you use Fluxure:</p>
      <ul>
        <li>
          <strong>Account information:</strong> Your name, email address, and profile avatar obtained
          from your Google account during authentication
        </li>
        <li>
          <strong>Calendar data:</strong> Event titles, times, durations, attendees, locations, and recurrence
          rules from your connected Google Calendars
        </li>
        <li>
          <strong>Scheduling data:</strong> Habits, tasks, meetings, focus time rules, buffer configurations,
          and priority settings you create within Fluxure
        </li>
        <li>
          <strong>Activity data:</strong> Scheduling history, habit completions, schedule changes, and
          analytics derived from your usage
        </li>
        <li>
          <strong>Technical data:</strong> IP address, browser user agent, and device information collected
          during authentication and API requests
        </li>
      </ul>
    </section>

    <section>
      <h2>2. How We Use Your Information</h2>
      <p>Your information is used exclusively for the following purposes:</p>
      <ul>
        <li>
          <strong>Scheduling:</strong> Analyzing your calendar availability to find optimal times for
          habits, tasks, and focus time using our scoring-based scheduling engine
        </li>
        <li>
          <strong>Calendar synchronization:</strong> Reading events from and writing scheduled items to
          your Google Calendar in real time
        </li>
        <li>
          <strong>Account management:</strong> Authentication, session management, and maintaining your
          preferences
        </li>
        <li>
          <strong>Service improvement:</strong> Understanding usage patterns to improve scheduling accuracy
          and the overall user experience
        </li>
      </ul>
      <p>
        We do not use your data for advertising, profiling, or any purpose unrelated to providing
        the scheduling service.
      </p>
    </section>

    <section>
      <h2>3. Google Calendar Data</h2>
      <p>
        Fluxure accesses your Google Calendar through Google's OAuth 2.0 authorization. The specific
        scopes requested are:
      </p>
      <ul>
        <li>
          <strong>Calendar read access:</strong> To retrieve your existing events and identify scheduling
          constraints (busy times, meetings, all-day events)
        </li>
        <li>
          <strong>Calendar write access:</strong> To create, update, and delete events that Fluxure manages
          on your behalf (habits, tasks, focus blocks)
        </li>
      </ul>
      <p>
        Fluxure uses incremental sync tokens to efficiently track changes to your calendar without
        repeatedly reading all events. Your Google OAuth refresh token is encrypted with AES-256-GCM
        before storage and is never stored in plain text.
      </p>
      <p>
        You can revoke Fluxure's access at any time through your <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer">Google Account permissions</a
        > or the Fluxure settings page.
      </p>
    </section>

    <section>
      <h2>4. Data Storage & Security</h2>
      <p>We implement the following security measures to protect your data:</p>
      <ul>
        <li>
          <strong>Encryption at rest:</strong> Database stored with encryption, Google OAuth refresh tokens
          encrypted with AES-256-GCM
        </li>
        <li><strong>Encryption in transit:</strong> All data transmitted over HTTPS (TLS)</li>
        <li>
          <strong>Authentication security:</strong> httpOnly, Secure, SameSite session cookies; rate-limited
          authentication endpoints (10 requests per 15 minutes)
        </li>
        <li>
          <strong>API protection:</strong> CORS restrictions, Content Security Policy headers, global
          rate limiting (100 requests per minute)
        </li>
        <li>
          <strong>Input validation:</strong> All API inputs validated with schema-based validation before
          processing
        </li>
      </ul>
    </section>

    <section>
      <h2>5. Data Sharing</h2>
      <p>
        We do not sell, rent, or trade your personal data to any third parties. Your data is not
        shared for advertising or marketing purposes.
      </p>
      <p>The only third-party service that receives your data is:</p>
      <ul>
        <li>
          <strong>Google Calendar API:</strong> To read and write calendar events as authorized by
          you. Google's own
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer"
            >Privacy Policy</a
          > applies to data processed by Google.
        </li>
      </ul>
      <p>We may disclose your data if required by law, court order, or governmental regulation.</p>
    </section>

    <section>
      <h2>6. Your Rights (GDPR)</h2>
      <p>
        Under the General Data Protection Regulation and applicable data protection laws, you have
        the right to:
      </p>
      <ul>
        <li><strong>Access:</strong> Request a copy of all personal data we hold about you</li>
        <li>
          <strong>Export:</strong> Download your data in a machine-readable JSON format via the data export
          feature in Settings
        </li>
        <li>
          <strong>Rectification:</strong> Update or correct your account information at any time
        </li>
        <li><strong>Erasure:</strong> Delete your account and all associated data permanently</li>
        <li>
          <strong>Portability:</strong> Receive your data in a structured, commonly used format
        </li>
        <li>
          <strong>Withdraw consent:</strong> Disconnect Google Calendar access or delete your account
          at any time
        </li>
        <li>
          <strong>Object:</strong> Object to specific data processing activities by contacting us
        </li>
      </ul>
      <p>
        To exercise any of these rights, use the relevant features in your account settings or
        contact us at <a href="mailto:{PRIVACY_EMAIL}">{PRIVACY_EMAIL}</a>.
      </p>
    </section>

    <section>
      <h2>7. Self-Hosted Users</h2>
      <p>
        If you are running a self-hosted instance of Fluxure, your data remains entirely on your own
        infrastructure. We have no access to, and no responsibility for, data stored in self-hosted
        deployments.
      </p>
      <p>
        Self-hosted users are responsible for their own data security, backups, and compliance with
        applicable data protection regulations. The security measures described in this policy apply
        only to the hosted version of Fluxure.
      </p>
    </section>

    <section>
      <h2>8. Cookies</h2>
      <p>Fluxure uses only strictly necessary cookies for authentication and session management:</p>
      <ul>
        <li>
          <strong>Session cookie:</strong> An httpOnly, Secure cookie that maintains your authenticated
          session
        </li>
        <li>
          <strong>CSRF token:</strong> A security token to prevent cross-site request forgery attacks
        </li>
      </ul>
      <p>
        We do not use analytics cookies, tracking cookies, advertising cookies, or any third-party
        cookies. Our cookies are exempt from GDPR cookie consent requirements as they are strictly
        necessary for the Service to function.
      </p>
    </section>

    <section>
      <h2>9. Data Retention</h2>
      <p>Your data is retained according to the following policies:</p>
      <ul>
        <li><strong>Account data:</strong> Retained for as long as your account is active</li>
        <li><strong>Session data:</strong> Automatically expires after 7 days of inactivity</li>
        <li>
          <strong>Calendar sync data:</strong> Cached calendar events are refreshed on each sync cycle
          and deleted when you disconnect a calendar
        </li>
        <li>
          <strong>Account deletion:</strong> When you delete your account, all associated data is permanently
          removed via cascading deletion. This action is irreversible.
        </li>
      </ul>
    </section>

    <section>
      <h2>10. Children's Privacy</h2>
      <p>
        Fluxure is not intended for use by anyone under the age of 16. We do not knowingly collect
        personal data from children under 16. If we become aware that we have collected data from a
        child under 16, we will take steps to delete that information promptly.
      </p>
    </section>

    <section>
      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time to reflect changes in our practices,
        technology, or legal requirements. When we make significant changes, we will notify you via
        email or through an in-app notification at least 30 days before the changes take effect.
      </p>
      <p>
        Your continued use of Fluxure after the updated policy takes effect constitutes your
        acceptance of the changes. We encourage you to review this policy periodically.
      </p>
    </section>

    <section>
      <h2>12. Contact</h2>
      <p>
        For privacy-related inquiries, data access requests, or to exercise your data protection
        rights, please contact us at:
      </p>
      <p>
        <a href="mailto:{PRIVACY_EMAIL}">{PRIVACY_EMAIL}</a>
      </p>
    </section>

    <div class="legal-footer">
      <a href="/">Back to home</a>
      <span class="legal-sep">&middot;</span>
      <a href="/terms">Terms of Service</a>
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
  }

  .legal-content {
    max-width: 680px;
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

  .legal-brand-name {
    font-family: $font-heading;
    font-size: 1.125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  h1 {
    font-family: $font-heading;
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.015em;
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
    font-family: $font-heading;
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 var(--space-3);
  }

  p {
    font-size: 0.9375rem;
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
    font-size: 0.9375rem;
    line-height: 1.7;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-1);
  }

  strong {
    color: var(--color-text);
    font-weight: 500;
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

  .legal-sep {
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }
</style>
