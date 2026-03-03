/**
 * Detects whether setting `habitId.dependsOn = dependsOn` would create a
 * circular dependency chain among the given habits.
 */
export function detectCycle(
  habitId: string,
  dependsOn: string | null,
  allHabits: ReadonlyArray<{ id: string; dependsOn: string | null }>,
): boolean {
  if (!dependsOn) return false;

  const visited = new Set<string>();
  let current: string | null = dependsOn;

  while (current) {
    if (current === habitId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const dep = allHabits.find((h) => h.id === current);
    current = dep?.dependsOn ?? null;
  }

  return false;
}
