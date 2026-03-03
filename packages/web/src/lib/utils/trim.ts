/**
 * Returns a shallow copy of the object with all top-level string values trimmed.
 * Non-string values are preserved as-is. Does NOT mutate the input.
 */
export function trimStrings<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'string' ? value.trim() : value;
  }
  return result as T;
}
