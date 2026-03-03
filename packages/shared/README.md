# @fluxure/shared

Shared types, enums, constants, and utilities used by all packages in the Fluxure monorepo. This package is the dependency root — `engine`, `api`, and `web` all import from it.

## Key Exports

### Enums

| Enum                 | Values                                      |
| -------------------- | ------------------------------------------- |
| `Priority`           | 1 (Critical), 2 (High), 3 (Medium), 4 (Low) |
| `ItemType`           | Habit, Task, Meeting, Focus                 |
| `EventStatus`        | Free, Busy, Tentative                       |
| `Frequency`          | Daily, Weekly, Biweekly, Monthly, Custom    |
| `ScheduleChangeType` | Created, Moved, Resized, Deleted            |
| `PlanType`           | SelfHosted, CloudFree, CloudPro, CloudTeam  |

### Constants

| Constant         | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `STATUS_PREFIX`  | Prefix for managed event statuses in Google Calendar           |
| `EXTENDED_PROPS` | Extended property keys for Fluxure metadata on calendar events |
| `TYPE_ORDER`     | Sort order: Meeting > Habit > Task > Focus                     |
| `RATE_LIMIT`     | Default rate limit configuration values                        |

### Plan Limits

```typescript
import { PlanLimits, getPlanLimits } from '@fluxure/shared';

const limits = getPlanLimits(PlanType.CloudFree);
// { maxHabits: 3, maxCalendars: 2, maxSchedulingLinks: 1, ... }
```

### Natural Language Parser

```typescript
import { parseQuickAdd } from '@fluxure/shared';

parseQuickAdd('Gym MWF 7am 1h');
// { type: 'habit', title: 'Gym', days: ['mon','wed','fri'], time: '07:00', duration: 60 }

parseQuickAdd('Finish report by Friday 3h');
// { type: 'task', title: 'Finish report', deadline: '2026-03-20', duration: 180 }

parseQuickAdd('Call with Sarah weekly Thu 2pm 30m');
// { type: 'meeting', title: 'Call with Sarah', frequency: 'weekly', day: 'thu', time: '14:00', duration: 30 }
```

Regex-based parser in `src/nl-parser.ts`. Supports habits (with day patterns), tasks (with deadlines and durations), and meetings (with recurrence). Used by the dashboard quick-add bar via `POST /api/quick-add`.

### Auth Types

Shared TypeScript types for authentication used by both `api` and `web`:

- `AuthUser`, `AuthTokens`, `SignupRequest`, `LoginRequest`
- `PasswordResetRequest`, `EmailVerificationRequest`
- `SessionInfo`, `GdprExportData`

## File Structure

```
src/
  index.ts          # Re-exports everything
  types.ts          # Domain types (ScheduleItem, CalendarOperation, etc.)
  auth-types.ts     # Auth request/response types
  nl-parser.ts      # Natural language quick-add parser
  constants.ts      # STATUS_PREFIX, EXTENDED_PROPS, TYPE_ORDER
  plan-limits.ts    # Plan tier definitions and feature gates
```

## Commands

```bash
pnpm build   # tsc (must build before other packages)
pnpm test    # vitest run (39 tests — NL parser + plan limits)
```

## Build Order

This package must be built first in the monorepo. The root `pnpm build` handles this automatically. When developing, `pnpm dev` at the root runs all packages in parallel with watch mode.
