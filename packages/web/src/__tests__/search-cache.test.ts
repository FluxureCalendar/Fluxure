import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCachedIndex, setCachedIndex, invalidateSearchCache } from '$lib/search-cache';
import type { SearchIndex } from '@fluxure/shared';

const mockIndex: SearchIndex = {
  habits: [
    {
      id: 'h1',
      name: 'Meditate',
      priority: 2,
      color: '#4285f4',
      enabled: true,
      days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    },
  ],
  tasks: [],
  meetings: [],
  events: [],
};

describe('search cache', () => {
  beforeEach(() => {
    invalidateSearchCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when cache is empty', () => {
    expect(getCachedIndex()).toBeNull();
  });

  it('returns cached index after setting it', () => {
    setCachedIndex(mockIndex);
    expect(getCachedIndex()).toBe(mockIndex);
  });

  it('returns null after cache TTL expires (5 minutes)', () => {
    setCachedIndex(mockIndex);
    expect(getCachedIndex()).toBe(mockIndex);

    vi.advanceTimersByTime(5 * 60 * 1000); // exactly 5 min
    expect(getCachedIndex()).toBeNull();
  });

  it('returns cached data before TTL expires', () => {
    setCachedIndex(mockIndex);
    vi.advanceTimersByTime(4 * 60 * 1000 + 59_999); // just under 5 min
    expect(getCachedIndex()).toBe(mockIndex);
  });

  it('invalidateSearchCache clears the cache immediately', () => {
    setCachedIndex(mockIndex);
    expect(getCachedIndex()).toBe(mockIndex);

    invalidateSearchCache();
    expect(getCachedIndex()).toBeNull();
  });

  it('overwrites previous cache with new data', () => {
    setCachedIndex(mockIndex);
    const newIndex: SearchIndex = { ...mockIndex, habits: [] };
    setCachedIndex(newIndex);
    expect(getCachedIndex()).toBe(newIndex);
  });

  it('resets TTL on re-set', () => {
    setCachedIndex(mockIndex);
    vi.advanceTimersByTime(4 * 60 * 1000);

    // Re-set refreshes the timer
    const newIndex: SearchIndex = { ...mockIndex, tasks: [] };
    setCachedIndex(newIndex);

    vi.advanceTimersByTime(4 * 60 * 1000);
    // Total 8 minutes since first set, but only 4 since re-set
    expect(getCachedIndex()).toBe(newIndex);
  });
});
