// Global cross-page cache using Svelte 5 module-level $state.
// Pages check cache first, only fetch if null. Invalidate on mutations.

import type { UserConfig, Calendar } from '@fluxure/shared';
import type { SchedulingTemplate } from '$lib/api';

// --- Settings ---
let settingsCache = $state<UserConfig | null>(null);

export function getCachedSettings(): UserConfig | null {
  return settingsCache;
}

export function setCachedSettings(s: UserConfig): void {
  settingsCache = s;
}

export function invalidateSettings(): void {
  settingsCache = null;
}

// --- Calendars ---
let calendarsCache = $state<Calendar[] | null>(null);

export function getCachedCalendars(): Calendar[] | null {
  return calendarsCache;
}

export function setCachedCalendars(c: Calendar[]): void {
  calendarsCache = c;
}

export function invalidateCalendars(): void {
  calendarsCache = null;
}

// --- Scheduling Templates ---
let templatesCache = $state<SchedulingTemplate[] | null>(null);

export function getCachedTemplates(): SchedulingTemplate[] | null {
  return templatesCache;
}

export function setCachedTemplates(t: SchedulingTemplate[]): void {
  templatesCache = t;
}

export function invalidateTemplates(): void {
  templatesCache = null;
}
