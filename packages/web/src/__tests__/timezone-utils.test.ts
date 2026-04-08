import { describe, it, expect } from 'vitest';
import { groupTimezones } from '$lib/utils/timezone';
import type { TimezoneGroup } from '$lib/utils/timezone';

describe('groupTimezones', () => {
  // Run once — Intl.supportedValuesOf is deterministic per runtime
  const groups: TimezoneGroup[] = groupTimezones();

  it('returns an array of groups', () => {
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
  });

  it('each group has a label and non-empty zones array', () => {
    for (const group of groups) {
      expect(typeof group.label).toBe('string');
      expect(group.label.length).toBeGreaterThan(0);
      expect(Array.isArray(group.zones)).toBe(true);
      expect(group.zones.length).toBeGreaterThan(0);
    }
  });

  it('includes common region groups', () => {
    const labels = groups.map((g) => g.label);
    expect(labels).toContain('America');
    expect(labels).toContain('Europe');
    expect(labels).toContain('Asia');
  });

  it('groups are sorted alphabetically by label (except Other at end)', () => {
    const labels = groups.map((g) => g.label);
    const hasOther = labels[labels.length - 1] === 'Other';
    const sortable = hasOther ? labels.slice(0, -1) : labels;
    const sorted = [...sortable].sort((a, b) => a.localeCompare(b));
    expect(sortable).toEqual(sorted);
  });

  it('zones within each group are sorted', () => {
    for (const group of groups) {
      const sorted = [...group.zones].sort();
      expect(group.zones).toEqual(sorted);
    }
  });

  it('all zones contain a slash (except Other group)', () => {
    for (const group of groups) {
      if (group.label === 'Other') continue;
      for (const zone of group.zones) {
        expect(zone).toContain('/');
      }
    }
  });

  it('includes well-known timezones', () => {
    const allZones = groups.flatMap((g) => g.zones);
    expect(allZones).toContain('America/New_York');
    expect(allZones).toContain('Europe/London');
    expect(allZones).toContain('Asia/Tokyo');
  });
});
