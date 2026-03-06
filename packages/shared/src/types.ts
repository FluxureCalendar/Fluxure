export enum Priority {
  Critical = 1,
  High = 2,
  Medium = 3,
  Low = 4,
}

export enum ItemType {
  Meeting = 'meeting',
  Habit = 'habit',
  Task = 'task',
  Focus = 'focus',
  External = 'external',
}

export enum EventStatus {
  Free = 'free',
  Busy = 'busy',
  Locked = 'locked',
  Completed = 'completed',
}

export enum TaskStatus {
  Open = 'open',
  DoneScheduling = 'done_scheduling',
  Completed = 'completed',
}

export enum Frequency {
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  Custom = 'custom',
}

export enum SchedulingHours {
  Working = 'working',
  Personal = 'personal',
  Custom = 'custom',
}

export enum CalendarMode {
  Writable = 'writable',
  Locked = 'locked',
}

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type ConferenceType =
  | 'zoom'
  | 'google_meet'
  | 'teams'
  | 'webex'
  | 'phone'
  | 'in_person'
  | 'other'
  | 'none';

/** Payload shape for GET /api/search/index — cached client-side for instant filtering */
export interface SearchIndex {
  habits: Array<{
    id: string;
    name: string;
    priority: Priority;
    color: string | null;
    enabled: boolean;
    days: DayOfWeek[];
  }>;
  tasks: Array<{
    id: string;
    name: string;
    priority: Priority | null;
    color: string | null;
    status: TaskStatus | null;
    dueDate: string | null;
    enabled: boolean;
  }>;
  meetings: Array<{
    id: string;
    name: string;
    priority: Priority | null;
    color: string | null;
    duration: number;
    frequency: Frequency;
    enabled: boolean;
  }>;
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    isAllDay: boolean;
  }>;
}

export interface Habit {
  id: string;
  name: string;
  priority: Priority;
  windowStart: string; // HH:MM
  windowEnd: string; // HH:MM
  idealTime: string; // HH:MM
  durationMin: number; // minutes
  durationMax: number; // minutes
  /** Which days of the week this habit runs — e.g. ["mon","wed","fri"] */
  days: DayOfWeek[];
  schedulingHours: SchedulingHours;
  /** All occurrences are pinned — scheduler won't move this habit */
  forced: boolean;
  autoDecline: boolean;
  dependsOn: string | null; // habit ID
  enabled: boolean;
  skipBuffer: boolean;
  /** UI/API-only — not used by the scheduling engine */
  notifications: boolean;
  calendarId?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrequencyConfig {
  days?: DayOfWeek[]; // ["mon", "tue", ...]
  weekInterval?: number; // every N weeks
  monthDay?: number; // day of month
  monthWeek?: number; // nth week of month (1-5)
  monthWeekday?: string; // day of that week
}

export interface Task {
  id: string;
  name: string;
  priority: Priority;
  totalDuration: number; // minutes
  remainingDuration: number; // minutes
  dueDate: string | null; // ISO datetime
  earliestStart: string | null; // ISO datetime
  chunkMin: number; // minutes
  chunkMax: number; // minutes
  schedulingHours: SchedulingHours;
  status: TaskStatus;
  isUpNext: boolean;
  skipBuffer: boolean;
  enabled: boolean;
  calendarId?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmartMeeting {
  id: string;
  name: string;
  priority: Priority;
  attendees: string[]; // email addresses
  duration: number; // minutes
  frequency: Frequency;
  /** Optional for simple weekly/daily meetings that don't need extra config */
  frequencyConfig?: FrequencyConfig;
  idealTime: string | null; // HH:MM
  windowStart: string | null; // HH:MM
  windowEnd: string | null; // HH:MM
  location: string;
  conferenceType: ConferenceType;
  skipBuffer: boolean;
  enabled: boolean;
  calendarId?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FocusTimeRule {
  id: string;
  weeklyTargetMinutes: number;
  dailyTargetMinutes: number;
  schedulingHours: SchedulingHours;
  windowStart: string | null;
  windowEnd: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BufferConfig {
  breakBetweenItemsMinutes: number;
}

export interface SchedulingLink {
  id: string;
  slug: string;
  name: string;
  durations: number[]; // [15, 30, 60]
  schedulingHours: SchedulingHours;
  priority: Priority;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Calendar {
  id: string;
  googleCalendarId: string;
  name: string;
  color: string;
  mode: CalendarMode;
  enabled: boolean;
  isPrimary: boolean;
  syncToken: string | null;
}

export interface HabitCompletion {
  id: string;
  habitId: string;
  scheduledDate: string;
  completedAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  name: string;
  completed: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  createdAt: string;
}

export interface CalendarEvent {
  id: string;
  googleEventId: string;
  title: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  isManaged: boolean; // created/managed by us
  itemType: ItemType | null;
  itemId: string | null; // FK to habit/task/meeting/focus
  status: EventStatus;
  location: string | null;
  description: string | null;
  calendarId: string | null; // which calendar this event belongs to
  /** ISO timestamp of when Fluxure last wrote this event to Google Calendar. */
  lastModifiedByUs: string | null;
  /** ISO timestamp from Google's `updated` field — set on every modification by any actor. */
  googleUpdatedAt: string | null;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface ScheduleItem {
  id: string;
  name?: string; // human-readable name for calendar titles
  type: ItemType;
  priority: Priority;
  timeWindow: TimeSlot; // allowed scheduling window
  idealTime: string; // HH:MM preferred time
  duration: number; // minutes (preferred / max duration)
  durationMin?: number; // minimum acceptable duration (for flexible items)
  skipBuffer: boolean; // skip buffer/travel time for this item
  forced: boolean; // entity-level: all occurrences pinned in place
  dependsOn: string | null;
}

export interface CandidateSlot extends TimeSlot {
  score: number; // higher = better
}

export enum CalendarOpType {
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
}

export interface CalendarOperation {
  type: CalendarOpType;
  /** For Create: both absent. For Update/Delete: at least one must be present. */
  eventId?: string; // internal DB id for local operations
  googleEventId?: string; // Google Calendar event id for API operations
  itemType: ItemType;
  itemId: string;
  title: string;
  start: string; // ISO datetime
  end: string; // ISO datetime
  status: EventStatus;
  extendedProperties: Record<string, string>;
  calendarId?: string; // target calendar for this operation
  useDefaultReminders?: boolean;
}

export interface ScheduleResult {
  operations: CalendarOperation[];
  unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }>;
}

export interface UserSettings {
  workingHours: { start: string; end: string }; // HH:MM
  personalHours: { start: string; end: string };
  timezone: string;
  schedulingWindowDays: number; // how far ahead to schedule
  defaultHabitCalendarId?: string | null;
  defaultTaskCalendarId?: string | null;
  trimCompletedEvents?: boolean; // shrink events when marked complete early (default: true)
  freeSlotOnComplete?: boolean; // allow scheduler to use completed event's time slot (default: false)
  breakBetweenItemsMinutes?: number; // gap between scheduled items (default: 10)
  autoCompleteHabits?: boolean; // auto-mark habits as done when scheduled time ends (default: true)
}

export interface UserConfig {
  id: string;
  settings: UserSettings;
  googleSyncToken: string | null;
  createdAt: string;
}

export interface CreateHabitRequest {
  name: string;
  priority?: Priority;
  windowStart: string;
  windowEnd: string;
  idealTime: string;
  durationMin: number;
  durationMax: number;
  /** Which days of the week — e.g. ["mon","wed","fri"]. At least 1 required. */
  days: DayOfWeek[];
  schedulingHours?: SchedulingHours;
  forced?: boolean;
  autoDecline?: boolean;
  dependsOn?: string | null;
  skipBuffer?: boolean;
  notifications?: boolean;
  calendarId?: string;
  color?: string;
}

export interface CreateTaskRequest {
  name: string;
  priority?: Priority;
  totalDuration: number;
  dueDate?: string | null;
  earliestStart?: string;
  chunkMin?: number;
  chunkMax?: number;
  schedulingHours?: SchedulingHours;
  skipBuffer?: boolean;
  calendarId?: string;
  color?: string;
}

export interface CreateMeetingRequest {
  name: string;
  priority?: Priority;
  attendees?: string[];
  duration: number;
  frequency: Frequency;
  idealTime: string;
  windowStart: string;
  windowEnd: string;
  location?: string;
  conferenceType?: ConferenceType;
  skipBuffer?: boolean;
  calendarId?: string;
  color?: string;
}

export interface CreateLinkRequest {
  name: string;
  slug: string;
  durations: number[];
  schedulingHours?: SchedulingHours;
  priority?: Priority;
}

export interface BookingSlot {
  start: string; // ISO datetime
  end: string; // ISO datetime
}

export interface BookingRequest {
  start: string; // ISO datetime
  end: string; // ISO datetime
  name: string;
  email: string;
  notes?: string;
}

export interface BookingConfirmation {
  id: string;
  slug: string;
  title: string;
  start: string;
  end: string;
  duration: number;
  name: string | null;
  email: string | null;
  createdAt: string;
}

export interface BookingLinkInfo {
  slug: string;
  name: string;
  durations: number[];
  enabled: boolean;
  timezone: string;
}

export enum ScheduleChangeType {
  Created = 'created',
  Moved = 'moved',
  Resized = 'resized',
  Deleted = 'deleted',
  Completed = 'completed',
  Locked = 'locked',
  Unlocked = 'unlocked',
}

export interface ScheduleChange {
  id: string;
  operationType: ScheduleChangeType;
  itemType: ItemType;
  itemId: string;
  itemName: string;
  previousStart: string | null;
  previousEnd: string | null;
  newStart: string | null;
  newEnd: string | null;
  reason: string | null;
  batchId: string;
  createdAt: string;
}

export interface QualityComponent {
  score: number; // 0-100
  weight: number; // 0-1
  label: string;
}

export interface QualityScore {
  overall: number; // 0-100 weighted average
  components: {
    placement: QualityComponent;
    idealTime: QualityComponent;
    focusTime: QualityComponent;
    buffers: QualityComponent;
    priorities: QualityComponent;
  };
  breakdown: string[]; // human-readable notes
}

export interface AnalyticsData {
  habitMinutes: number;
  taskMinutes: number;
  meetingMinutes: number;
  focusMinutes: number;
  habitCompletionRate: number;
  weeklyBreakdown: Array<{
    date: string;
    habitMinutes: number;
    taskMinutes: number;
    meetingMinutes: number;
    focusMinutes: number;
  }>;
}
