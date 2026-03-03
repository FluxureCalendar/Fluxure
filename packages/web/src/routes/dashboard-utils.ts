import { differenceInMinutes } from '@fluxure/shared';

export interface CalEvent {
  dayIndex: number;
  startHour: number;
  duration: number;
  title: string;
  type: 'habit' | 'task' | 'meeting' | 'focus' | 'manual' | 'external';
  calendarColor?: string;
  calendarName?: string;
  itemColor?: string;
  id?: string;
  itemId?: string;
  startISO: string;
  endISO: string;
  status?: string;
  location?: string;
  isAllDay?: boolean;
}

export const eventTypeMap: Record<string, { bg: string; border: string; label: string }> = {
  habit: { bg: 'var(--color-habit-bg)', border: 'var(--color-habit-border)', label: 'Habit' },
  task: { bg: 'var(--color-task-bg)', border: 'var(--color-task-border)', label: 'Task' },
  meeting: {
    bg: 'var(--color-meeting-bg)',
    border: 'var(--color-meeting-border)',
    label: 'Meeting',
  },
  focus: { bg: 'var(--color-focus-bg)', border: 'var(--color-focus-border)', label: 'Focus' },
  external: {
    bg: 'var(--color-external-bg)',
    border: 'var(--color-external-border)',
    label: 'External',
  },
};

export const legendItems = [
  { type: 'habit', label: 'Habit' },
  { type: 'task', label: 'Task' },
  { type: 'meeting', label: 'Meeting' },
  { type: 'focus', label: 'Focus' },
  { type: 'external', label: 'External' },
];

export interface ApiEvent {
  id?: string | null;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  itemType?: string | null;
  itemId?: string | null;
  status?: string | null;
  location?: string | null;
  calendarColor?: string | null;
  calendarName?: string | null;
  itemColor?: string | null;
  isAllDay?: boolean | null;
}

export function mapApiEvents(
  apiEvents: ApiEvent[],
  getHourInTz: (date: Date) => number,
  getDayInTz: (date: Date) => number,
): CalEvent[] {
  const mapped: CalEvent[] = [];
  for (const ev of apiEvents) {
    if (!ev.start || !ev.end) continue;
    const isAllDay = !!ev.isAllDay;
    const startDate = new Date(ev.start);
    const endDateEv = new Date(ev.end);
    if (isNaN(startDate.getTime()) || isNaN(endDateEv.getTime())) continue;
    const dayOfWeek = getDayInTz(startDate);
    const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startHour = isAllDay ? 0 : getHourInTz(startDate);
    const duration = isAllDay ? 24 : differenceInMinutes(endDateEv, startDate) / 60;
    const type = ev.itemType || 'manual';
    mapped.push({
      dayIndex,
      startHour,
      duration,
      title: ev.title || '(No title)',
      type: type as CalEvent['type'],
      calendarColor: ev.calendarColor ?? undefined,
      calendarName: ev.calendarName ?? undefined,
      itemColor: ev.itemColor ?? undefined,
      id: ev.id ?? undefined,
      itemId: ev.itemId ?? undefined,
      startISO: ev.start,
      endISO: ev.end,
      status: ev.status ?? undefined,
      location: ev.location ?? undefined,
      isAllDay: !!isAllDay,
    });
  }
  return mapped;
}
