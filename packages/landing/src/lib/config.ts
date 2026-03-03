// Central config — all brand + external URLs in one place.
// Override at build time with VITE_* env vars if needed.

// Brand
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Fluxure';
export const TAGLINE = import.meta.env.VITE_TAGLINE || 'Your calendar, intelligently managed';
export const DESCRIPTION =
  import.meta.env.VITE_DESCRIPTION ||
  `${APP_NAME} automatically schedules your habits, tasks, and focus time around your existing calendar. Open-source, self-hostable.`;

// URLs
export const APP_URL = import.meta.env.VITE_APP_URL || 'https://app.fluxure.app';
export const GITHUB_URL =
  import.meta.env.VITE_GITHUB_URL || 'https://github.com/FluxureCalendar/Fluxure';

// Contact
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@fluxure.app';
export const PRIVACY_EMAIL = import.meta.env.VITE_PRIVACY_EMAIL || 'privacy@fluxure.app';
