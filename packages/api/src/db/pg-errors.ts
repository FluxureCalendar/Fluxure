/**
 * PostgreSQL error-code helpers.
 *
 * drizzle-orm (since the bump in `9b7e254`) wraps every driver failure in a
 * `DrizzleQueryError`. That wrapper has `.query`/`.params`/`.cause` but **no
 * `.code`** — the original `pg` error, which carries the SQLSTATE `code`,
 * sits on `.cause`. Older drizzle threw the raw `pg` error directly, so call
 * sites that did `err.code === '23505'` silently stopped matching after the
 * upgrade and started re-throwing expected duplicate/FK errors.
 *
 * `pgErrorCode` walks the `cause` chain so callers work regardless of how
 * deep the driver error is wrapped.
 */

/** SQLSTATE 23505 — unique_violation (duplicate key). */
export const PG_UNIQUE_VIOLATION = '23505';

/** SQLSTATE 23503 — foreign_key_violation. */
export const PG_FK_VIOLATION = '23503';

// Bounded so a self-referential `cause` chain can never loop forever.
const MAX_CAUSE_DEPTH = 5;

/**
 * Extract the PostgreSQL SQLSTATE code from an error, unwrapping any
 * `DrizzleQueryError` (or other) wrappers via the `cause` chain.
 *
 * Returns the first string `code` found, or `undefined` when the error
 * carries no SQLSTATE code (non-DB error, non-object, numeric API code, …).
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;

  for (let depth = 0; current != null && depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    if (typeof current !== 'object') break;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
