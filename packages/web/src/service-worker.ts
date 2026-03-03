/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `fluxure-cache-${version}`;
const HTML_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// App shell: JS/CSS bundles + static assets
const APP_SHELL = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  sw.clients.claim();
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin !== sw.location.origin) return;

  // Never cache Vite dev server requests
  if (
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@fs/') ||
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/src/')
  )
    return;

  // API calls: network-only (responses are per-user)
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: 'You are offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    return;
  }

  if (url.pathname.startsWith('/ws')) return;

  // App shell assets: cache-first (Vite hashes filenames for cache busting)
  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
    return;
  }

  // HTML navigation: network-first with stale cache fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.headers.get('cache-control')?.includes('no-store')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            const dateHeader = cached.headers.get('date');
            if (dateHeader) {
              const age = Date.now() - new Date(dateHeader).getTime();
              if (age > HTML_CACHE_TTL_MS) {
                const cache = await caches.open(CACHE_NAME);
                await cache.delete(request);
                return caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }));
              }
            }
            return cached;
          }
          return caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }));
        }),
    );
    return;
  }

  // Other assets: serve from cache while revalidating in background
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok && !response.headers.get('cache-control')?.includes('no-store')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
      return cached ?? networkFetch;
    }),
  );
});
