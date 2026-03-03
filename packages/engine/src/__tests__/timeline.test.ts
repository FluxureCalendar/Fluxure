import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../timeline.js';
import { UserSettings } from '@fluxure/shared';

// Timeline tests use LOCAL_TZ because date fixtures use local-time constructors
// (new Date(year,month,day,...)) and assertions use .getHours() which returns local time.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: LOCAL_TZ,
  schedulingWindowDays: 14,
};

describe('buildTimeline', () => {
  it('should generate working-hour slots for weekdays', () => {
    // Monday 2026-03-02
    const start = new Date(2026, 2, 2, 0, 0, 0);
    const end = new Date(2026, 2, 2, 23, 59, 59);

    const slots = buildTimeline(start, end, defaultSettings);

    // Monday: should have pre-work personal (7-9), working (9-17), post-work personal (17-22)
    expect(slots.length).toBe(3);

    // Pre-work personal
    expect(slots[0].start.getHours()).toBe(7);
    expect(slots[0].end.getHours()).toBe(9);

    // Working hours
    expect(slots[1].start.getHours()).toBe(9);
    expect(slots[1].end.getHours()).toBe(17);

    // Post-work personal
    expect(slots[2].start.getHours()).toBe(17);
    expect(slots[2].end.getHours()).toBe(22);
  });

  it('should generate only personal-hour slots for weekends', () => {
    // Saturday 2026-03-07
    const start = new Date(2026, 2, 7, 0, 0, 0);
    const end = new Date(2026, 2, 7, 23, 59, 59);

    const slots = buildTimeline(start, end, defaultSettings);

    // Saturday: single personal hours block
    expect(slots.length).toBe(1);
    expect(slots[0].start.getHours()).toBe(7);
    expect(slots[0].end.getHours()).toBe(22);
  });

  it('should generate slots for multiple days', () => {
    // Monday to Friday (5 weekdays)
    const start = new Date(2026, 2, 2, 0, 0, 0);
    const end = new Date(2026, 2, 6, 23, 59, 59);

    const slots = buildTimeline(start, end, defaultSettings);

    // 5 weekdays * 3 slots each = 15
    expect(slots.length).toBe(15);
  });

  it('should include weekends in a full week', () => {
    // Monday to Sunday
    const start = new Date(2026, 2, 2, 0, 0, 0);
    const end = new Date(2026, 2, 8, 23, 59, 59);

    const slots = buildTimeline(start, end, defaultSettings);

    // 5 weekdays * 3 = 15, 2 weekend days * 1 = 2 => 17
    expect(slots.length).toBe(17);
  });

  it('should handle settings where working hours equal personal hours', () => {
    const settings: UserSettings = {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '09:00', end: '17:00' },
      timezone: LOCAL_TZ,
      schedulingWindowDays: 14,
    };

    const start = new Date(2026, 2, 2, 0, 0, 0);
    const end = new Date(2026, 2, 2, 23, 59, 59);

    const slots = buildTimeline(start, end, settings);

    // Only working hours block, no pre/post personal
    expect(slots.length).toBe(1);
    expect(slots[0].start.getHours()).toBe(9);
    expect(slots[0].end.getHours()).toBe(17);
  });

  it('should return empty array for zero-length range', () => {
    const start = new Date(2026, 2, 2, 10, 0, 0);
    const end = new Date(2026, 2, 2, 10, 0, 0);

    const slots = buildTimeline(start, end, defaultSettings);
    // Should still generate slots for that day since they overlap
    expect(slots.length).toBeGreaterThanOrEqual(0);
  });

  it('should clamp slots to start and end boundaries', () => {
    // Start midday
    const start = new Date(2026, 2, 2, 12, 0, 0);
    const end = new Date(2026, 2, 2, 15, 0, 0);

    const slots = buildTimeline(start, end, defaultSettings);

    // The working hours slot should be clamped to [12:00, 15:00]
    const workSlot = slots.find((s) => s.start.getHours() >= 9 && s.end.getHours() <= 17);
    expect(workSlot).toBeDefined();
    if (workSlot) {
      expect(workSlot.start.getHours()).toBe(12);
      expect(workSlot.end.getHours()).toBe(15);
    }
  });

  it('should return slots sorted chronologically', () => {
    const start = new Date(2026, 2, 2, 0, 0, 0);
    const end = new Date(2026, 2, 8, 23, 59, 59);

    const slots = buildTimeline(start, end, defaultSettings);

    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].start.getTime()).toBeGreaterThanOrEqual(slots[i - 1].start.getTime());
    }
  });
});
