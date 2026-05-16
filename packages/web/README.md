# @fluxure/web

The Fluxure web app — a SvelteKit (Svelte 5) **PWA**, built with `adapter-static` in SPA mode. This is the authenticated product UI (dashboard, habits/tasks/focus, scheduling links, settings, onboarding, public booking, privacy).

## Stack

- **Framework:** SvelteKit 2 + Svelte 5 (runes)
- **Adapter:** `adapter-static` (SPA, precompressed Brotli + gzip)
- **Styles:** SCSS via `sass-embedded`. Entry `src/lib/styles/main.scss`; mixins consumed with `@use '$lib/styles/mixins' as *;`
- **Icons:** Lucide via deep imports (`lucide-svelte/icons/x`) for tree-shaking
- **Fonts:** Geist Sans / Geist Mono via `@fontsource`
- **State:** Svelte 5 runes; auth state in `src/lib/auth.svelte.ts`

## Key modules

| Path                     | Purpose                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `src/lib/auth.svelte.ts` | Reactive auth state + auth API calls                                                   |
| `src/lib/api.ts`         | Fetch client with automatic access-token refresh                                       |
| `src/lib/ws.ts`          | WebSocket client; `subscribeConnectionState()` for the offline indicator               |
| `src/lib/styles/`        | SCSS entry + partials (`_variables`, `_mixins`, `_components`, `_auth`, `_onboarding`) |
| `src/service-worker.ts`  | Cache-first static, network-first navigation                                           |
| `src/routes/`            | App pages + `/book/[slug]` public booking + `/privacy`                                 |

## Development

```sh
pnpm web:dev      # Vite dev server on :5173 (proxies /api and /ws to :3000)
pnpm web:build    # Static build to build/
pnpm web:preview  # Preview the production build
pnpm web:check    # Svelte + TypeScript type checking (the test gate for this package)
```

Requires the API running on `:3000` (see the repo root `README.md` / `pnpm dev`).

## Conventions

- Auth tokens are stored in **httpOnly cookies** (set by the API), never in `localStorage`.
- No shared component library — compose UI with global SCSS classes; CRUD uses right-slide-over panels (420px), not modals.
- New Lucide icons must be added to `optimizeDeps.include` in `vite.config.ts`.
- Theme is intentionally zen / calm / minimalistic.

See `CLAUDE.md` in this directory for deeper editing guidance.
