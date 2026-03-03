# @fluxure/engine

Pure scheduling algorithm for Fluxure. Takes domain objects, calendar events, and user settings as input and returns calendar operations as output. No database access, no authentication, no side effects.

## Key Exports

```typescript
import { reschedule } from '@fluxure/engine';
import { calculateScheduleQuality } from '@fluxure/engine';

// Core scheduling — returns Create/Update/Delete operations
const ops: CalendarOperation[] = reschedule(items, events, settings);

// Schedule health score (0-100)
const quality = calculateScheduleQuality(items, events, settings);
```

## Algorithm

Greedy placement with priority-based ordering:

1. Domain objects (habits, tasks, meetings) converted to `ScheduleItem[]` with day-specific IDs (`${itemId}__${dateStr}`)
2. Items sorted by priority (1-4), then by `TYPE_ORDER` (Meeting > Habit > Task > Focus)
3. For each item: generate candidate time slots, score each slot, place the best
4. Focus time placed last, only when available time drops below 1.5x the user's target
5. Diff against existing managed events to produce minimal Create/Update/Delete operations

## Modules

| File           | Purpose                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `scheduler.ts` | Main scheduling loop, item sorting, greedy placement                                                   |
| `scoring.ts`   | Slot scoring with Gaussian ideal-time decay (sigma 45min for user-set times, 75min for auto-generated) |
| `slots.ts`     | Candidate slot generation within scheduling windows                                                    |
| `free-busy.ts` | Free/busy status computation from calendar events                                                      |
| `timeline.ts`  | Scheduling window construction (working hours, custom windows, templates)                              |
| `quality.ts`   | Schedule quality score — 5 weighted components                                                         |
| `utils.ts`     | Timezone helpers using `Intl.DateTimeFormat` (no moment/luxon)                                         |

## Quality Score

`calculateScheduleQuality()` returns a weighted score from 0-100:

| Component            | Weight | Measures                                     |
| -------------------- | ------ | -------------------------------------------- |
| Placement rate       | 30%    | How many items were successfully placed      |
| Ideal time proximity | 25%    | How close placements are to preferred times  |
| Focus achievement    | 20%    | Whether focus time targets are met           |
| Buffer compliance    | 15%    | Whether buffers between events are respected |
| Priority respect     | 10%    | Whether high-priority items got better slots |

## Design Decisions

- **Pure functions only** — no I/O, no global state, fully testable in isolation
- **Timezone via Intl** — all timezone operations use `Intl.DateTimeFormat` helpers, avoiding heavy libraries
- **DST-safe** — `buildDayWindow` handles midnight crossover, `enumerateDays` uses DST-safe day advancement
- **Task chunking** — tasks split into `chunk0`, `chunk1`, etc. based on `chunkMin`/`chunkMax` with inter-chunk ordering dependencies
- **Immutable** — scoring and slot generation return new objects, never mutate inputs

## Commands

```bash
pnpm build       # tsc
pnpm test        # vitest run (98 tests)
pnpm test:watch  # vitest watch mode
```

## Test Coverage

98 tests across scheduler, scoring, slot generation, free-busy computation, timeline construction, and quality scoring. Run individual test files with:

```bash
npx vitest run src/__tests__/scheduler.test.ts
npx vitest run src/__tests__/quality.test.ts
```
