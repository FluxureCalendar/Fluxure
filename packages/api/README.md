# @fluxure/api

Express REST API server for Fluxure. Handles authentication, Google Calendar sync, scheduling orchestration, and real-time updates via WebSocket.

## Stack

- **Runtime:** Node.js + Express
- **Database:** PostgreSQL 16 via Drizzle ORM
- **Validation:** Zod schemas on all inputs
- **Auth:** JWT (access 15min + refresh 7d) in httpOnly cookies
- **Logging:** Pino structured logging
- **Jobs:** BullMQ job queues backed by Redis
- **Caching:** Redis

## Routes

23 route modules under `src/routes/`:

| Route                  | Description                                                                       |
| ---------------------- | --------------------------------------------------------------------------------- |
| `auth`                 | Signup, login, logout, refresh, verify email, forgot/reset password, Google OAuth |
| `habits`               | CRUD for recurring habits                                                         |
| `tasks`                | CRUD for one-off tasks with chunking support                                      |
| `meetings`             | CRUD for smart meetings                                                           |
| `focus`                | Focus time rules                                                                  |
| `buffers`              | Buffer configuration between events                                               |
| `schedule`             | Trigger reschedule, get quality score, get changes                                |
| `settings`             | User preferences (working hours, timezone, etc.)                                  |
| `calendars`            | Google Calendar list and sync management                                          |
| `links`                | Scheduling links for public booking                                               |
| `booking`              | Public booking endpoints (no auth required)                                       |
| `quick-add`            | Natural language item creation via shared NL parser                               |
| `search`               | Full-text search across items                                                     |
| `activity`             | Activity log                                                                      |
| `analytics`            | Schedule analytics and quality trends                                             |
| `webhooks`             | Google Calendar push notification receiver                                        |
| `scheduling-templates` | Reusable time window presets                                                      |
| `billing`              | Stripe subscription management                                                    |

## Key Modules

- **`scheduler-registry.ts`** — Manages per-user `UserScheduler` instances. Lazy init, 30min idle cleanup, concurrency guard (one reschedule at a time per user).
- **`google/`** — Calendar sync (incremental via sync tokens), push notifications with polling fallback, OAuth flow.
- **`db/pg-schema.ts`** — Drizzle schema with 18 tables, all scoped by `userId` FK with `ON DELETE CASCADE`.
- **`validation.ts`** — Zod schemas for every request body and query parameter.
- **`middleware/auth.ts`** — `requireAuth` middleware extracts `userId`, `userEmail`, `userPlan` from JWT cookie.
- **`ws.ts`** — Per-user WebSocket channels for `schedule_updated` and `schedule_changes` broadcasts.

## Commands

```bash
pnpm dev       # tsx watch, runs on :3000
pnpm build     # tsc
pnpm test      # vitest run (72 tests)
pnpm test:watch
```

## Environment

Requires a `.env` file at the repo root (see `.env.example`):

| Variable               | Required     | Description                                         |
| ---------------------- | ------------ | --------------------------------------------------- |
| `DATABASE_URL`         | Yes          | PostgreSQL connection string                        |
| `JWT_SECRET`           | Yes          | Min 32 chars, signs access tokens                   |
| `JWT_REFRESH_SECRET`   | Yes          | Min 32 chars, signs refresh tokens                  |
| `ENCRYPTION_KEY`       | Yes          | AES-256-GCM key for Google refresh token encryption |
| `GOOGLE_CLIENT_ID`     | For calendar | Google OAuth client ID                              |
| `GOOGLE_CLIENT_SECRET` | For calendar | Google OAuth client secret                          |
| `GOOGLE_REDIRECT_URI`  | For calendar | OAuth callback URL                                  |
| `WEBHOOK_BASE_URL`     | Optional     | Enables push notifications instead of polling       |
| `CORS_ORIGIN`          | Optional     | Allowed origin for CORS                             |
| `SMTP_*`               | Optional     | Email verification (HOST, PORT, USER, PASS, FROM)   |

## Security

- All queries scoped by `userId` (tenant isolation)
- Rate limiting on auth endpoints, booking, and webhooks
- Parameterized queries via Drizzle (no raw SQL)
- Refresh tokens rotated on use, SHA-256 hashed in DB
- Google refresh tokens encrypted at rest (AES-256-GCM)
- CSP, CORS, and Helmet headers
- WebSocket origin validation
