/**
 * Singleton reactive calendar store with cache-first loading.
 * Pages import `loadCalendars()` and `getCalendars()` instead of
 * duplicating the cache-check-then-fetch pattern.
 */

import { calendars as calendarsApi } from '$lib/api';
import { getCachedCalendars, setCachedCalendars } from '$lib/cache.svelte';
import type { Calendar } from '@fluxure/shared';

let calendarList = $state<Calendar[]>([]);
let loaded = $state(false);

/**
 * Load calendars using cache-first strategy.
 * Safe to call multiple times — only fetches once unless `force` is true.
 */
export async function loadCalendars(force = false): Promise<Calendar[]> {
  if (loaded && !force) return calendarList;

  const cached = getCachedCalendars();
  if (cached && !force) {
    calendarList = cached;
    loaded = true;
    return calendarList;
  }

  try {
    const calendars = await calendarsApi.list();
    calendarList = calendars;
    setCachedCalendars(calendars);
    loaded = true;
  } catch {
    // If fetch fails but cache exists, use cache
    const fallback = getCachedCalendars();
    if (fallback) {
      calendarList = fallback;
      loaded = true;
    }
  }

  return calendarList;
}

/**
 * Get the current calendar list (reactive).
 * Call `loadCalendars()` first to populate.
 */
export function getCalendars(): Calendar[] {
  return calendarList;
}

/**
 * Update the calendar list directly (e.g., after a toggle or discover).
 * Also updates the global cache.
 */
export function setCalendars(calendars: Calendar[]): void {
  calendarList = calendars;
  setCachedCalendars(calendars);
  loaded = true;
}

/**
 * Whether calendars have been loaded at least once.
 */
export function isCalendarsLoaded(): boolean {
  return loaded;
}
