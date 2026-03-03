# Contributing to Fluxure

## Setup

```bash
# Prerequisites: Node.js 22+, pnpm 9+, PostgreSQL 16+
git clone https://github.com/FluxureCalendar/Fluxure.git && cd Fluxure
pnpm install
cp .env.example .env   # edit with your DB URL, JWT secrets, Google OAuth
pnpm dev               # API on :3000, Web on :5173
```

Build order: `shared` must build before other packages (`pnpm build` handles this).

## Code Style

- **Strict TypeScript** — no `any`, use `unknown` with type guards
- **Immutable patterns** — return new objects, never mutate arguments
- **Small files** (200-400 lines, 800 max) and **small functions** (<50 lines)
- **SCSS** — use `@use '$lib/styles/mixins' as *;`, colors in `_variables.scss`
- **Zod validation** on all API inputs
- Run `pnpm format` before committing

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`

## Testing

```bash
pnpm test              # all packages
cd packages/engine && npx vitest run src/__tests__/scheduler.test.ts  # single file
```

80% coverage minimum. Write tests first when possible.

## Pull Requests

1. Branch from `main` with a descriptive name (`feat/...`, `fix/...`)
2. Ensure tests, types, and build all pass
3. One feature or fix per PR
4. Explain the "why" in the PR description

## License

By contributing, you agree your work is licensed under [AGPL-3.0](LICENSE).
