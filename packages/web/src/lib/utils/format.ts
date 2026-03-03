/**
 * Format a duration in minutes to a human-readable string.
 * Examples: 30 -> "30m", 60 -> "1h", 90 -> "1h 30m"
 */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Format an ISO date string to a short display format (e.g., "Mar 7").
 * Returns empty string for null/undefined input.
 */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
