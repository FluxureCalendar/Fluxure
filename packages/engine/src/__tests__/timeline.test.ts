import { describe, it, expect } from 'vitest';
import { buildTimeline, getSchedulingWindow } from '../timeline.js';
import { UserSettings, SchedulingHours } from '@fluxure/shared';

// Timeline tests use LOCAL_TZ because date fixtures use local-time constructors
// (new Date(year,month,day,...)) and assertions use .getHours() which returns local time.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: LOCAL_TZ,
  schedulingWindowDays: 14,
};

describe('getSchedulingWindow', () => {
  it('should return working hours for Working type', () => {
    const result = getSchedulingWindow(SchedulingHours.Working, defaultSettings);
    expect(result).toEqual({ start: '09:00', end: '17:00' });
  });

  it('should return personal hours for Personal type', () => {
    const result = getSchedulingWindow(SchedulingHours.Personal, defaultSettings);
    expect(result).toEqual({ start: '07:00', end: '22:00' });
  });

  it('should return personal hours for Custom type (fallback)', () => {
    const result = getSchedulingWindow(SchedulingHours.Custom, defaultSettings);
    expect(result).toEqual({ start: '07:00', end: '22:00' });
  });
});

describe('buildTimeline', () => {
  describe('Weekday slot generation', () => {
    it('should produce 3 slots for a weekday: pre-work personal, working, post-work personal', () => {
      // Monday 2026-03-02
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      expect(slots).toHaveLength(3);

      // Pre-work personal: 7:00–9:00
      expect(slots[0].start.getHours()).toBe(7);
      expect(slots[0].end.getHours()).toBe(9);

      // Working hours: 9:00–17:00
      expect(slots[1].start.getHours()).toBe(9);
      expect(slots[1].end.getHours()).toBe(17);

      // Post-work personal: 17:00–22:00
      expect(slots[2].start.getHours()).toBe(17);
      expect(slots[2].end.getHours()).toBe(22);
    });

    it('should produce only 1 slot when personal hours equal working hours', () => {
      const settings: UserSettings = {
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '09:00', end: '17:00' },
        timezone: LOCAL_TZ,
        schedulingWindowDays: 14,
      };

      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, settings);

      expect(slots).toHaveLength(1);
      expect(slots[0].start.getHours()).toBe(9);
      expect(slots[0].end.getHours()).toBe(17);
    });

    it('should produce 2 slots when personal starts at work start but ends later', () => {
      const settings: UserSettings = {
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '09:00', end: '22:00' },
        timezone: LOCAL_TZ,
        schedulingWindowDays: 14,
      };

      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, settings);

      // No pre-work personal, just working + post-work personal
      expect(slots).toHaveLength(2);
      expect(slots[0].start.getHours()).toBe(9);
      expect(slots[0].end.getHours()).toBe(17);
      expect(slots[1].start.getHours()).toBe(17);
      expect(slots[1].end.getHours()).toBe(22);
    });

    it('should produce 2 slots when personal ends at work end but starts earlier', () => {
      const settings: UserSettings = {
        workingHours: { start: '09:00', end: '17:00' },
        personalHours: { start: '07:00', end: '17:00' },
        timezone: LOCAL_TZ,
        schedulingWindowDays: 14,
      };

      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, settings);

      // Pre-work personal + working, no post-work personal
      expect(slots).toHaveLength(2);
      expect(slots[0].start.getHours()).toBe(7);
      expect(slots[0].end.getHours()).toBe(9);
      expect(slots[1].start.getHours()).toBe(9);
      expect(slots[1].end.getHours()).toBe(17);
    });
  });

  describe('Weekend slot generation', () => {
    it('should produce a single personal hours block for Saturday', () => {
      // Saturday 2026-03-07
      const start = new Date(2026, 2, 7, 0, 0, 0);
      const end = new Date(2026, 2, 7, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      expect(slots).toHaveLength(1);
      expect(slots[0].start.getHours()).toBe(7);
      expect(slots[0].end.getHours()).toBe(22);
    });

    it('should produce a single personal hours block for Sunday', () => {
      // Sunday 2026-03-08
      const start = new Date(2026, 2, 8, 0, 0, 0);
      const end = new Date(2026, 2, 8, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      expect(slots).toHaveLength(1);
      expect(slots[0].start.getHours()).toBe(7);
      expect(slots[0].end.getHours()).toBe(22);
    });
  });

  describe('Multi-day ranges', () => {
    it('should generate 15 slots for Mon–Fri (5 weekdays × 3 slots)', () => {
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 6, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);
      expect(slots).toHaveLength(15);
    });

    it('should generate 17 slots for a full Mon–Sun week (15 weekday + 2 weekend)', () => {
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 8, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);
      expect(slots).toHaveLength(17);
    });

    it('should generate 2 slots for a weekend-only range (Sat–Sun)', () => {
      const start = new Date(2026, 2, 7, 0, 0, 0);
      const end = new Date(2026, 2, 8, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);
      expect(slots).toHaveLength(2);
    });
  });

  describe('Clamping to start/end boundaries', () => {
    it('should clamp slots to a midday sub-range', () => {
      const start = new Date(2026, 2, 2, 12, 0, 0);
      const end = new Date(2026, 2, 2, 15, 0, 0);

      const slots = buildTimeline(start, end, defaultSettings);

      // Should get a clamped working-hours slot [12:00, 15:00]
      expect(slots.length).toBeGreaterThanOrEqual(1);
      const workSlot = slots.find((s) => s.start.getHours() >= 9 && s.end.getHours() <= 17);
      expect(workSlot).toBeDefined();
      if (workSlot) {
        expect(workSlot.start.getHours()).toBe(12);
        expect(workSlot.end.getHours()).toBe(15);
      }
    });

    it('should clamp pre-work personal slot when start is mid-personal', () => {
      const start = new Date(2026, 2, 2, 8, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      // Pre-work personal should be clamped: [8:00, 9:00] instead of [7:00, 9:00]
      expect(slots[0].start.getHours()).toBe(8);
      expect(slots[0].end.getHours()).toBe(9);
    });

    it('should clamp post-work personal slot when end is mid-evening', () => {
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 19, 0, 0);

      const slots = buildTimeline(start, end, defaultSettings);

      // Post-work personal should be clamped: [17:00, 19:00] instead of [17:00, 22:00]
      const postWork = slots[slots.length - 1];
      expect(postWork.start.getHours()).toBe(17);
      expect(postWork.end.getHours()).toBe(19);
    });
  });

  describe('Edge cases', () => {
    it('should return empty or minimal result for zero-length range', () => {
      const point = new Date(2026, 2, 2, 10, 0, 0);
      const slots = buildTimeline(point, point, defaultSettings);
      // Zero-length range — all clamped slots degenerate to zero-length and get filtered
      expect(slots).toHaveLength(0);
    });

    it('should handle start after end gracefully', () => {
      const start = new Date(2026, 2, 3, 0, 0, 0);
      const end = new Date(2026, 2, 2, 0, 0, 0);
      const slots = buildTimeline(start, end, defaultSettings);
      expect(slots).toHaveLength(0);
    });
  });

  describe('Chronological ordering', () => {
    it('should return all slots sorted by start time', () => {
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 8, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].start.getTime()).toBeGreaterThanOrEqual(slots[i - 1].start.getTime());
      }
    });

    it('should produce non-overlapping slots', () => {
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 8, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].start.getTime()).toBeGreaterThanOrEqual(slots[i - 1].end.getTime());
      }
    });
  });

  describe('Real-world scenarios', () => {
    it('focus block between meetings: working hours slot covers 9am–5pm', () => {
      // A user wants to find focus time during working hours
      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, defaultSettings);

      const workingSlot = slots.find((s) => s.start.getHours() === 9 && s.end.getHours() === 17);
      expect(workingSlot).toBeDefined();
      // 8 hours of working time available
      const durationHours =
        (workingSlot!.end.getTime() - workingSlot!.start.getTime()) / (1000 * 60 * 60);
      expect(durationHours).toBe(8);
    });

    it('early riser schedule: personal hours 5am–11pm', () => {
      const earlySettings: UserSettings = {
        workingHours: { start: '08:00', end: '16:00' },
        personalHours: { start: '05:00', end: '23:00' },
        timezone: LOCAL_TZ,
        schedulingWindowDays: 14,
      };

      const start = new Date(2026, 2, 2, 0, 0, 0);
      const end = new Date(2026, 2, 2, 23, 59, 59);

      const slots = buildTimeline(start, end, earlySettings);

      expect(slots).toHaveLength(3);
      // Pre-work: 5:00–8:00
      expect(slots[0].start.getHours()).toBe(5);
      expect(slots[0].end.getHours()).toBe(8);
      // Work: 8:00–16:00
      expect(slots[1].start.getHours()).toBe(8);
      expect(slots[1].end.getHours()).toBe(16);
      // Post-work: 16:00–23:00
      expect(slots[2].start.getHours()).toBe(16);
      expect(slots[2].end.getHours()).toBe(23);
    });

    it('two-week scheduling window produces correct slot count', () => {
      // 14 days: 10 weekdays × 3 + 4 weekend days × 1 = 34
      const start = new Date(2026, 2, 2, 0, 0, 0); // Monday
      const end = new Date(2026, 2, 15, 23, 59, 59); // Sunday (2 weeks)

      const slots = buildTimeline(start, end, defaultSettings);
      expect(slots).toHaveLength(34);
    });
  });
});
