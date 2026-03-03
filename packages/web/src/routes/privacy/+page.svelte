<script lang="ts">
  import { pageTitle } from '$lib/brand';
  import { resolve } from '$app/paths';
</script>

<svelte:head>
  <title>{pageTitle('Privacy Policy')}</title>
</svelte:head>

<div class="privacy-page">
  <div class="privacy-card">
    <div class="privacy-header">
      <a href={resolve('/')} class="privacy-brand">
        <span class="sidebar-logo">F</span>
        <span class="privacy-brand-name">Fluxure</span>
      </a>
    </div>

    <h1>Privacy Policy</h1>
    <p class="privacy-updated">Last updated: March 15, 2026</p>

    <section>
      <h2>1. Data Controller</h2>
      <p>
        Fluxure is a calendar scheduling application. When you use Fluxure, we process your personal
        data as described in this policy.
      </p>
    </section>

    <section>
      <h2>2. Data We Collect</h2>
      <p>We collect and process the following types of personal data:</p>
      <ul>
        <li>
          <strong>Account information:</strong> email address, name, and avatar (from Google profile if
          applicable)
        </li>
        <li>
          <strong>Authentication data:</strong> password hash (never stored in plain text), session tokens,
          OAuth refresh tokens (encrypted with AES-256-GCM)
        </li>
        <li>
          <strong>Calendar data:</strong> event titles, times, attendees, and locations from connected
          Google Calendars
        </li>
        <li>
          <strong>Scheduling data:</strong> habits, tasks, meetings, focus time rules, and buffer configurations
          you create
        </li>
        <li>
          <strong>Activity data:</strong> scheduling history, habit completions, and schedule changes
        </li>
        <li>
          <strong>Technical data:</strong> IP address, user agent (browser/device information), collected
          during authentication
        </li>
      </ul>
    </section>

    <section>
      <h2>3. How We Use Your Data</h2>
      <p>Your data is used exclusively for:</p>
      <ul>
        <li>
          <strong>Scheduling:</strong> Analyzing your calendar to find optimal times for habits, tasks,
          and focus time
        </li>
        <li>
          <strong>Calendar sync:</strong> Reading events from and writing scheduled items to your Google
          Calendar
        </li>
        <li>
          <strong>Account management:</strong> Authentication, session management, and email verification
        </li>
        <li>
          <strong>Service operation:</strong> Maintaining and improving the scheduling service
        </li>
      </ul>
      <p>
        We do not sell your data, use it for advertising, or share it with third parties beyond what
        is necessary to operate the service (Google Calendar API).
      </p>
    </section>

    <section>
      <h2>4. Legal Basis for Processing</h2>
      <ul>
        <li>
          <strong>Consent:</strong> You consent to calendar data access via Google OAuth during signup
          or when connecting Google Calendar
        </li>
        <li>
          <strong>Contract:</strong> Processing necessary to provide the scheduling service you signed
          up for
        </li>
        <li>
          <strong>Legitimate interest:</strong> Session management, security logging, and service operation
        </li>
      </ul>
    </section>

    <section>
      <h2>5. Data Storage & Security</h2>
      <ul>
        <li>Data is stored in a PostgreSQL database with encryption at rest</li>
        <li>Google OAuth refresh tokens are encrypted with AES-256-GCM before storage</li>
        <li>Passwords are hashed using bcrypt (12 rounds)</li>
        <li>All data is transmitted over HTTPS (TLS)</li>
        <li>Authentication uses httpOnly, Secure, SameSite cookies</li>
        <li>API endpoints are rate-limited and protected by CORS and CSP headers</li>
      </ul>
    </section>

    <section>
      <h2>6. Data Retention</h2>
      <p>
        Your data is retained for as long as your account is active. When you delete your account,
        all associated data is permanently removed via cascading deletion. Fluxure will also attempt
        to remove all managed events from your Google Calendar. Events that cannot be removed (e.g.,
        due to API errors) may remain on your calendar.
      </p>
      <ul>
        <li>
          <strong>Sessions:</strong> expire automatically after 7 days; expired sessions are cleaned up
          every 6 hours
        </li>
        <li><strong>Activity log:</strong> automatically deleted after 180 days</li>
        <li><strong>Schedule change history:</strong> automatically deleted after 30 days</li>
        <li>
          <strong>Password reset tokens:</strong> automatically deleted 24 hours after use or expiry
        </li>
      </ul>
    </section>

    <section>
      <h2>7. Third-Party Services</h2>
      <p>Fluxure integrates with:</p>
      <ul>
        <li>
          <strong>Google Calendar API:</strong> To read your calendar events and create scheduled items.
          Google's privacy policy applies to data processed by Google.
        </li>
      </ul>
      <p>
        No other third-party services receive your personal data. We do not use analytics tracking
        cookies.
      </p>
    </section>

    <section>
      <h2>8. Your Rights</h2>
      <p>Under GDPR and applicable data protection laws, you have the right to:</p>
      <ul>
        <li>
          <strong>Access:</strong> View all data we hold about you (available via Settings &gt; Privacy
          &amp; Data &gt; Export)
        </li>
        <li><strong>Portability:</strong> Download your data in a machine-readable JSON format</li>
        <li><strong>Rectification:</strong> Update your account information at any time</li>
        <li>
          <strong>Erasure:</strong> Delete your account and all associated data (Settings &gt; Delete
          Account)
        </li>
        <li>
          <strong>Withdraw consent:</strong> You can withdraw your GDPR consent at any time from Settings
          &gt; Privacy &amp; Data &gt; Withdraw Consent. This will pause all scheduling activity. You
          can also disconnect Google Calendar access or delete your account entirely.
        </li>
        <li><strong>Object:</strong> Contact us to object to specific processing activities</li>
      </ul>
    </section>

    <section>
      <h2>9. Cookies</h2>
      <p>
        Fluxure uses only strictly necessary cookies for authentication (session cookies and
        security tokens). These are exempt from GDPR cookie consent requirements. We do not use
        analytics, tracking, or advertising cookies.
      </p>
    </section>

    <section>
      <h2>10. Age Eligibility</h2>
      <p>
        Fluxure is intended for users aged 18 and older. We do not knowingly collect personal data
        from anyone under 18. If you are under 18, please do not use this service. If we become
        aware that we have collected data from a user under 18, we will promptly delete the account
        and all associated data.
      </p>
    </section>

    <section>
      <h2>11. Data Breach Notification</h2>
      <p>
        In the event of a data breach that poses a risk to your rights and freedoms, we will notify
        the relevant supervisory authority within 72 hours of becoming aware of the breach, as
        required by GDPR Article 33. If the breach is likely to result in a high risk to you
        personally, we will also notify you directly via the email address associated with your
        account.
      </p>
      <p>
        Breach notifications will include the nature of the breach, the categories and approximate
        number of individuals affected, the likely consequences, and the measures taken or proposed
        to address it.
      </p>
    </section>

    <section>
      <h2>12. Changes to This Policy</h2>
      <p>
        We may update this privacy policy from time to time. Significant changes will be
        communicated via email or in-app notification. Continued use of Fluxure after changes
        constitutes acceptance.
      </p>
    </section>

    <section>
      <h2>13. Data Protection Contact</h2>
      <p>
        For privacy-related inquiries, data requests, or to exercise your rights, please contact our
        Data Protection Officer at:
      </p>
      <p>
        <a href="mailto:privacy@fluxure.app" class="privacy-email">privacy@fluxure.app</a>
      </p>
    </section>

    <div class="privacy-footer">
      <a href={resolve('/settings')}>Back to Settings</a>
    </div>
  </div>
</div>

<style lang="scss">
  @use '$lib/styles/mixins' as *;

  .privacy-page {
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-bg);
  }

  .privacy-card {
    max-width: 680px;
    width: 100%;
  }

  .privacy-header {
    margin-bottom: var(--space-8);
  }

  .privacy-brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    text-decoration: none;
    color: var(--color-text);
  }

  .privacy-brand-name {
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

  .privacy-updated {
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

  strong {
    color: var(--color-text);
    font-weight: 500;
  }

  .privacy-email {
    color: var(--color-accent);
    text-decoration: none;
    font-weight: 500;

    &:hover {
      text-decoration: underline;
    }
  }

  .privacy-footer {
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
