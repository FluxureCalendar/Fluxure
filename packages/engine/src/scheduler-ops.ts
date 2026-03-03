import {
  ScheduleItem,
  TimeSlot,
  CalendarEvent,
  CalendarOperation,
  CalendarOpType,
  ItemType,
  EventStatus,
} from '@fluxure/shared';
import { EXTENDED_PROPS } from '@fluxure/shared';

/**
 * Generate calendar operations by diffing placements against existing managed events.
 */
export function generateCalendarOperations(
  placements: Map<string, TimeSlot>,
  statuses: Map<string, EventStatus>,
  itemMap: Map<string, ScheduleItem>,
  existingManagedEvents: Map<string, CalendarEvent>,
  lockedExistingIds: Set<string> = new Set(),
): CalendarOperation[] {
  const operations: CalendarOperation[] = [];
  const processedExistingIds = new Set<string>(lockedExistingIds);

  for (const [itemId, placement] of placements) {
    const item = itemMap.get(itemId);
    if (!item) continue;

    const status = statuses.get(itemId) ?? EventStatus.Free;
    const existingEvent = existingManagedEvents.get(itemId);

    // Extract original entity ID — "__" is the separator for date/chunk suffixes
    const sepIdx = itemId.lastIndexOf('__');
    const originalItemId = sepIdx > 0 ? itemId.substring(0, sepIdx) : itemId;
    const title = item.name || `${item.type}: ${originalItemId}`;

    if (existingEvent) {
      processedExistingIds.add(itemId);
      const existingStart = new Date(existingEvent.start);
      const existingEnd = new Date(existingEvent.end);

      if (
        existingStart.getTime() !== placement.start.getTime() ||
        existingEnd.getTime() !== placement.end.getTime() ||
        existingEvent.status !== status ||
        existingEvent.title !== title
      ) {
        operations.push({
          type: CalendarOpType.Update,
          eventId: existingEvent.id,
          googleEventId: existingEvent.googleEventId || undefined,
          itemType: item.type,
          itemId,
          title,
          start: placement.start.toISOString(),
          end: placement.end.toISOString(),
          status,
          extendedProperties: {
            [EXTENDED_PROPS.fluxureId]: existingEvent.id,
            [EXTENDED_PROPS.itemType]: item.type,
            [EXTENDED_PROPS.itemId]: originalItemId,
            [EXTENDED_PROPS.status]: status,
          },
        });
      }
    } else {
      operations.push({
        type: CalendarOpType.Create,
        itemType: item.type,
        itemId,
        title,
        start: placement.start.toISOString(),
        end: placement.end.toISOString(),
        status,
        extendedProperties: {
          [EXTENDED_PROPS.itemType]: item.type,
          [EXTENDED_PROPS.itemId]: originalItemId,
          [EXTENDED_PROPS.status]: status,
        },
      });
    }
  }

  // Delete events that are no longer placed
  for (const [itemId, event] of existingManagedEvents) {
    if (!processedExistingIds.has(itemId)) {
      const delSepIdx = itemId.lastIndexOf('__');
      const originalItemId = delSepIdx > 0 ? itemId.substring(0, delSepIdx) : itemId;
      operations.push({
        type: CalendarOpType.Delete,
        eventId: event.id,
        googleEventId: event.googleEventId || undefined,
        itemType: event.itemType ?? ItemType.Task,
        itemId,
        title: event.title,
        start: event.start,
        end: event.end,
        status: event.status,
        extendedProperties: {
          [EXTENDED_PROPS.fluxureId]: event.id,
          [EXTENDED_PROPS.itemType]: event.itemType ?? ItemType.Task,
          [EXTENDED_PROPS.itemId]: originalItemId,
          [EXTENDED_PROPS.status]: event.status,
        },
      });
    }
  }

  return operations;
}
