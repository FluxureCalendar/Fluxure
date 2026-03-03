# Fluxure

**Open-source intelligent calendar scheduling**

[![CI](https://github.com/FluxureCalendar/Fluxure/actions/workflows/ci.yml/badge.svg)](https://github.com/FluxureCalendar/Fluxure/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Fluxure automatically places habits, tasks, meetings, and focus time on Google Calendar. A greedy scheduling engine scores candidate time slots and syncs via the Google Calendar API.

## Features

- **Habits** — Recurring activities with flexible frequency and preferred time windows
- **Tasks** — Deadline-driven work, auto-chunked into manageable blocks
- **Meetings** — Smart scheduling with attendee management and conflict detection
- **Focus Time** — Protected deep work blocks
- **Public Booking** — Shareable scheduling links with availability detection
- **Quick-Add** — Natural language parsing ("Gym MWF 7am 1h")
- **Quality Score** — Weighted 0-100 metric for schedule health
- **PWA** — Installable with offline caching and real-time sync
- **Billing** — Free and Pro tiers with Stripe, 14-day trial

## Architecture

pnpm monorepo with four packages:

```
packages/
  shared/    Types, constants, NL parser
  engine/    Pure scheduling algorithm
  api/       Express + Drizzle ORM + PostgreSQL
  web/       SvelteKit (Svelte 5) PWA
```

## Quick Start

```bash
cp .env.example .env    # configure DATABASE_URL, JWT_SECRET, Google OAuth
pnpm install && pnpm dev
```

- **API:** http://localhost:3000
- **Web:** http://localhost:5173

Or with Docker: `docker compose up -d`

## Tech Stack

| Layer    | Technology                                |
| -------- | ----------------------------------------- |
| Frontend | SvelteKit (Svelte 5), SCSS, Vite          |
| Backend  | Express, Node.js, PostgreSQL, Drizzle ORM |
| Auth     | JWT (httpOnly cookies), Google OAuth      |
| Calendar | Google Calendar API (push + polling)      |
| Payments | Stripe                                    |
| Infra    | Docker, GitHub Actions CI, Vitest         |

## Documentation

- [Deployment Guide](DEPLOY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

[AGPL-3.0](LICENSE)
