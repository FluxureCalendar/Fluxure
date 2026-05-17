/**
 * Scheduled-event staleness by *original scheduled date* (the itemId suffix),
 * independent of the row's `end` column.
 *
 * Retention (`PAST_EVENT_RETENTION_DAYS`) keys off `end`, which a locked move
 * rewrites forward — so a locked occurrence dragged far from its original date
 * evades it indefinitely. This predicate keys off the frozen `__YYYY-MM-DD`
 * suffix instead, so such rows still get reaped.
 *
 * Non-date suffixes (task `__chunkN`, plain ids) are never stale here — the
 * date parse is the type guard.
 */
export function isStaleScheduledItemId(
  itemId: string | null | undefined,
  cutoffMs: number,
): boolean {
  if (!itemId) return false;
  const datePart = itemId.split('__')[1];
  if (!datePart) return false;
  const ts = Date.parse(datePart);
  if (Number.isNaN(ts)) return false;
  return ts < cutoffMs;
}
