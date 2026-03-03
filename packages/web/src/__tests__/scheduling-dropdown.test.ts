import { describe, it, expect, vi } from 'vitest';
import {
  handleScheduleDropdownChange,
  getScheduleDropdownValue,
} from '$lib/utils/scheduling-dropdown';
import { SchedulingHours } from '@fluxure/shared';
import type { SchedulingTemplate } from '$lib/api';

const mockTemplates: SchedulingTemplate[] = [
  {
    id: 'tmpl-1',
    userId: 'user-1',
    name: 'Morning Block',
    startTime: '06:00',
    endTime: '09:00',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'tmpl-2',
    userId: 'user-1',
    name: 'Evening Block',
    startTime: '18:00',
    endTime: '21:00',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
];

describe('handleScheduleDropdownChange', () => {
  it('handles built-in scheduling hours value', () => {
    const setFields = vi.fn();
    handleScheduleDropdownChange('working', mockTemplates, setFields);

    expect(setFields).toHaveBeenCalledWith('working', null);
  });

  it('handles personal scheduling hours value', () => {
    const setFields = vi.fn();
    handleScheduleDropdownChange('personal', mockTemplates, setFields);

    expect(setFields).toHaveBeenCalledWith('personal', null);
  });

  it('handles template selection with valid template ID', () => {
    const setFields = vi.fn();
    handleScheduleDropdownChange('template:tmpl-1', mockTemplates, setFields);

    expect(setFields).toHaveBeenCalledWith(SchedulingHours.Custom, 'tmpl-1');
  });

  it('handles template selection with second template', () => {
    const setFields = vi.fn();
    handleScheduleDropdownChange('template:tmpl-2', mockTemplates, setFields);

    expect(setFields).toHaveBeenCalledWith(SchedulingHours.Custom, 'tmpl-2');
  });

  it('does not call setFields for non-existent template', () => {
    const setFields = vi.fn();
    handleScheduleDropdownChange('template:non-existent', mockTemplates, setFields);

    expect(setFields).not.toHaveBeenCalled();
  });

  it('handles custom scheduling hours value', () => {
    const setFields = vi.fn();
    handleScheduleDropdownChange('custom', mockTemplates, setFields);

    expect(setFields).toHaveBeenCalledWith('custom', null);
  });
});

describe('getScheduleDropdownValue', () => {
  it('returns template-prefixed value when template is selected', () => {
    expect(getScheduleDropdownValue('custom', 'tmpl-1')).toBe('template:tmpl-1');
  });

  it('returns scheduling hours when no template is selected', () => {
    expect(getScheduleDropdownValue('working', null)).toBe('working');
  });

  it('returns scheduling hours for personal with no template', () => {
    expect(getScheduleDropdownValue('personal', null)).toBe('personal');
  });

  it('returns scheduling hours for custom with no template', () => {
    expect(getScheduleDropdownValue('custom', null)).toBe('custom');
  });

  it('prefers template over scheduling hours value', () => {
    expect(getScheduleDropdownValue('working', 'tmpl-2')).toBe('template:tmpl-2');
  });
});
