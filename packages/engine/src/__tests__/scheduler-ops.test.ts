import { describe, it, expect } from 'vitest';
import { generateCalendarOperations } from '../scheduler-ops.js';
import { ITEM_ID_SEPARATOR } from '../scheduler.js';
import {
  ScheduleItem,
  CalendarEvent,
  TimeSlot,
  CalendarOpType,
  ItemType,
  EventStatus,
  Priority,
  EXTENDED_PROPS,
} from '@fluxure/shared';
import { makeCalendarEvent } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'habit-1__2026-03-02',
    name: 'Morning Exercise',
    type: ItemType.Habit,
    priority: Priority.Medium,
    timeWindow: {
      start: new Date('2026-03-02T14:00:00Z'),
      end: new Date('2026-03-02T22:00:00Z'),
    },
    idealTime: '09:00',
    duration: 30,
    skipBuffer: false,
    forced: false,
    dependsOn: null,
    ...overrides,
  };
}

function slot(startISO: string, endISO: string): TimeSlot {
  return { start: new Date(startISO), end: new Date(endISO) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCalendarOperations', () => {
  describe('create new events', () => {
    it('generates Create when no existing managed event exists', () => {
      const item = makeItem();
      const placement = slot('2026-03-02T14:00:00Z', '2026-03-02T14:30:00Z');
      const placements = new Map([['habit-1__2026-03-02', placement]]);
      const statuses = new Map([['habit-1__2026-03-02', EventStatus.Free]]);
      const itemMap = new Map([['habit-1__2026-03-02', item]]);
      const existing = new Map<string, CalendarEvent>();

      const ops = generateCalendarOperations(placements, statuses, itemMap, existing);

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe(CalendarOpType.Create);
      expect(ops[0].itemId).toBe('habit-1__2026-03-02');
      expect(ops[0].title).toBe('Morning Exercise');
      expect(ops[0].status).toBe(EventStatus.Free);
      expect(ops[0].start).toBe(placement.start.toISOString());
      expect(ops[0].end).toBe(placement.end.toISOString());
    });

    it('sets extendedProperties.itemId to the original entity ID (strips separator suffix)', () => {
      const item = makeItem({ id: 'task-abc__chunk0', name: 'My Task', type: ItemType.Task });
      const placement = slot('2026-03-02T14:00:00Z', '2026-03-02T15:00:00Z');
      const placements = new Map([['task-abc__chunk0', placement]]);
      const statuses = new Map([['task-abc__chunk0', EventStatus.Free]]);
      const itemMap = new Map([['task-abc__chunk0', item]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, new Map());

      expect(ops[0].extendedProperties?.[EXTENDED_PROPS.itemId]).toBe('task-abc');
    });
  });

  describe('update existing events', () => {
    it('generates Update when time changes', () => {
      const item = makeItem();
      const newPlacement = slot('2026-03-02T15:00:00Z', '2026-03-02T15:30:00Z');
      const existingEvent = makeCalendarEvent({
        id: 'evt-1',
        googleEventId: 'g-evt-1',
        title: 'Morning Exercise',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T14:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-1__2026-03-02',
        status: EventStatus.Free,
      });

      const placements = new Map([['habit-1__2026-03-02', newPlacement]]);
      const statuses = new Map([['habit-1__2026-03-02', EventStatus.Free]]);
      const itemMap = new Map([['habit-1__2026-03-02', item]]);
      const existing = new Map([['habit-1__2026-03-02', existingEvent]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, existing);

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe(CalendarOpType.Update);
      expect(ops[0].eventId).toBe('evt-1');
      expect(ops[0].start).toBe(newPlacement.start.toISOString());
    });

    it('generates Update when title changes', () => {
      const item = makeItem({ name: 'Renamed Exercise' });
      const placement = slot('2026-03-02T14:00:00Z', '2026-03-02T14:30:00Z');
      const existingEvent = makeCalendarEvent({
        id: 'evt-1',
        title: 'Morning Exercise',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T14:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-1__2026-03-02',
        status: EventStatus.Free,
      });

      const placements = new Map([['habit-1__2026-03-02', placement]]);
      const statuses = new Map([['habit-1__2026-03-02', EventStatus.Free]]);
      const itemMap = new Map([['habit-1__2026-03-02', item]]);
      const existing = new Map([['habit-1__2026-03-02', existingEvent]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, existing);

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe(CalendarOpType.Update);
      expect(ops[0].title).toBe('Renamed Exercise');
    });

    it('generates Update when status changes', () => {
      const item = makeItem();
      const placement = slot('2026-03-02T14:00:00Z', '2026-03-02T14:30:00Z');
      const existingEvent = makeCalendarEvent({
        id: 'evt-1',
        title: 'Morning Exercise',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T14:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-1__2026-03-02',
        status: EventStatus.Free,
      });

      const placements = new Map([['habit-1__2026-03-02', placement]]);
      const statuses = new Map([['habit-1__2026-03-02', EventStatus.Busy]]);
      const itemMap = new Map([['habit-1__2026-03-02', item]]);
      const existing = new Map([['habit-1__2026-03-02', existingEvent]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, existing);

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe(CalendarOpType.Update);
      expect(ops[0].status).toBe(EventStatus.Busy);
    });

    it('generates no operation when nothing changed', () => {
      const item = makeItem();
      const placement = slot('2026-03-02T14:00:00.000Z', '2026-03-02T14:30:00.000Z');
      const existingEvent = makeCalendarEvent({
        id: 'evt-1',
        title: 'Morning Exercise',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T14:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-1__2026-03-02',
        status: EventStatus.Free,
      });

      const placements = new Map([['habit-1__2026-03-02', placement]]);
      const statuses = new Map([['habit-1__2026-03-02', EventStatus.Free]]);
      const itemMap = new Map([['habit-1__2026-03-02', item]]);
      const existing = new Map([['habit-1__2026-03-02', existingEvent]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, existing);

      expect(ops).toHaveLength(0);
    });
  });

  describe('delete removed events', () => {
    it('generates Delete for orphaned managed events', () => {
      const existingEvent = makeCalendarEvent({
        id: 'evt-orphan',
        title: 'Old Habit',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'old-habit__2026-03-02',
        status: EventStatus.Free,
      });

      const ops = generateCalendarOperations(
        new Map(),
        new Map(),
        new Map(),
        new Map([['old-habit__2026-03-02', existingEvent]]),
      );

      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe(CalendarOpType.Delete);
      expect(ops[0].eventId).toBe('evt-orphan');
    });

    it('handles null itemType on delete by defaulting to Task', () => {
      const existingEvent = makeCalendarEvent({
        id: 'evt-null-type',
        title: 'Unknown Type Event',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: null,
        itemId: 'unknown__2026-03-02',
        status: EventStatus.Free,
      });

      const ops = generateCalendarOperations(
        new Map(),
        new Map(),
        new Map(),
        new Map([['unknown__2026-03-02', existingEvent]]),
      );

      expect(ops[0].itemType).toBe(ItemType.Task);
    });

    it('does not delete locked existing events', () => {
      const existingEvent = makeCalendarEvent({
        id: 'evt-locked',
        title: 'Locked Event',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'locked-habit__2026-03-02',
        status: EventStatus.Locked,
      });

      const lockedIds = new Set(['locked-habit__2026-03-02']);
      const ops = generateCalendarOperations(
        new Map(),
        new Map(),
        new Map(),
        new Map([['locked-habit__2026-03-02', existingEvent]]),
        lockedIds,
      );

      expect(ops).toHaveLength(0);
    });
  });

  describe('ITEM_ID_SEPARATOR handling', () => {
    it('extracts original entity ID using last occurrence of separator', () => {
      // ID with multiple separators: "focus_rule-1__2026-03-02"
      const compoundId = `focus_rule-1${ITEM_ID_SEPARATOR}2026-03-02`;
      const item = makeItem({
        id: compoundId,
        name: 'Focus Block',
        type: ItemType.Focus,
      });
      const placement = slot('2026-03-02T14:00:00Z', '2026-03-02T15:00:00Z');

      const placements = new Map([[compoundId, placement]]);
      const statuses = new Map([[compoundId, EventStatus.Free]]);
      const itemMap = new Map([[compoundId, item]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, new Map());

      expect(ops[0].extendedProperties?.[EXTENDED_PROPS.itemId]).toBe('focus_rule-1');
    });

    it('handles IDs without separator (returns ID as-is)', () => {
      const item = makeItem({ id: 'simple-id', name: 'Simple', type: ItemType.Task });
      const placement = slot('2026-03-02T14:00:00Z', '2026-03-02T15:00:00Z');

      const placements = new Map([['simple-id', placement]]);
      const statuses = new Map([['simple-id', EventStatus.Free]]);
      const itemMap = new Map([['simple-id', item]]);

      const ops = generateCalendarOperations(placements, statuses, itemMap, new Map());

      expect(ops[0].extendedProperties?.[EXTENDED_PROPS.itemId]).toBe('simple-id');
    });
  });
});
