import type { SearchIndex } from '@fluxure/shared';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: SearchIndex | null = null;
let cacheTime = 0;

export function getCachedIndex(): SearchIndex | null {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cache;
  }
  return null;
}

export function setCachedIndex(data: SearchIndex): void {
  cache = data;
  cacheTime = Date.now();
}

export function invalidateSearchCache(): void {
  cache = null;
  cacheTime = 0;
}
