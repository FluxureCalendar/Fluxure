import { z } from 'zod/v4';
import { PASSWORD_MIN_LENGTH } from '@fluxure/shared';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

const frequencyConfigSchema = z
  .object({
    days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
    weekInterval: z.number().int().min(1).max(52).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    monthWeek: z.number().int().min(1).max(5).optional(),
    monthWeekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).optional(),
  })
  .optional();

const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid IANA timezone' },
);

export const createHabitSchema = z
  .object({
    name: z.string().min(1).max(200),
    priority: z.number().int().min(1).max(4).optional(),
    windowStart: z.string().regex(timeRegex, 'Must be HH:MM format'),
    windowEnd: z.string().regex(timeRegex, 'Must be HH:MM format'),
    idealTime: z.string().regex(timeRegex, 'Must be HH:MM format'),
    durationMin: z.number().int().positive().max(1440),
    durationMax: z.number().int().positive().max(1440),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
    frequencyConfig: frequencyConfigSchema,
    schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
    autoDecline: z.boolean().optional(),
    dependsOn: z.string().uuid().nullable().optional(),
    skipBuffer: z.boolean().optional(),
    notifications: z.boolean().optional(),
    calendarId: z.string().uuid().optional(),
    color: z.string().regex(hexColorRegex, 'Must be hex color #RRGGBB').optional(),
  })
  .refine(
    (data) =>
      !(
        data.durationMin !== undefined &&
        data.durationMax !== undefined &&
        data.durationMin > data.durationMax
      ),
    { message: 'durationMin must be <= durationMax' },
  )
  .refine((data) => !(data.windowStart && data.windowEnd && data.windowStart >= data.windowEnd), {
    message: 'windowStart must be before windowEnd',
  });

export const createTaskSchema = z
  .object({
    name: z.string().min(1).max(200),
    priority: z.number().int().min(1).max(4).optional(),
    totalDuration: z.number().int().positive().max(43200),
    dueDate: z.string().datetime({ offset: true }),
    earliestStart: z.string().datetime({ offset: true }).optional(),
    chunkMin: z.number().int().positive().max(1440).optional(),
    chunkMax: z.number().int().positive().max(1440).optional(),
    schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
    skipBuffer: z.boolean().optional(),
    calendarId: z.string().uuid().optional(),
    color: z.string().regex(hexColorRegex, 'Must be hex color #RRGGBB').optional(),
  })
  .refine(
    (data) =>
      !(
        data.chunkMin !== undefined &&
        data.chunkMax !== undefined &&
        data.chunkMin > data.chunkMax
      ),
    { message: 'chunkMin must be <= chunkMax' },
  )
  .refine(
    (data) =>
      !data.earliestStart || !data.dueDate || new Date(data.earliestStart) < new Date(data.dueDate),
    { message: 'Earliest start must be before due date', path: ['earliestStart'] },
  );

export const createMeetingSchema = z
  .object({
    name: z.string().min(1).max(200),
    priority: z.number().int().min(1).max(4).optional(),
    attendees: z.array(z.string().email()).max(50).optional(),
    duration: z.number().int().positive().max(1440),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
    idealTime: z.string().regex(timeRegex, 'Must be HH:MM format'),
    windowStart: z.string().regex(timeRegex, 'Must be HH:MM format'),
    windowEnd: z.string().regex(timeRegex, 'Must be HH:MM format'),
    location: z.string().max(500).optional(),
    conferenceType: z
      .enum(['zoom', 'google_meet', 'teams', 'webex', 'phone', 'in_person', 'other'])
      .optional(),
    skipBuffer: z.boolean().optional(),
    calendarId: z.string().uuid().optional(),
    color: z.string().regex(hexColorRegex, 'Must be hex color #RRGGBB').optional(),
  })
  .refine((data) => !(data.windowStart && data.windowEnd && data.windowStart >= data.windowEnd), {
    message: 'windowStart must be before windowEnd',
  });

export const createFocusSchema = z.object({
  weeklyTargetMinutes: z.number().int().positive().max(10080),
  dailyTargetMinutes: z.number().int().positive().max(1440),
  schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
  enabled: z.boolean().optional(),
});

export const createBufferSchema = z.object({
  travelTimeMinutes: z.number().int().min(0).max(480),
  decompressionMinutes: z.number().int().min(0).max(480),
  breakBetweenItemsMinutes: z.number().int().min(0).max(480),
  applyDecompressionTo: z.enum(['all', 'video_only']).optional(),
});

export const updateHabitSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    priority: z.number().int().min(1).max(4).optional(),
    windowStart: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
    windowEnd: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
    idealTime: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
    durationMin: z.number().int().positive().max(1440).optional(),
    durationMax: z.number().int().positive().max(1440).optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']).optional(),
    frequencyConfig: frequencyConfigSchema,
    schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
    autoDecline: z.boolean().optional(),
    dependsOn: z.string().uuid().nullable().optional(),
    skipBuffer: z.boolean().optional(),
    notifications: z.boolean().optional(),
    calendarId: z.string().uuid().optional(),
    color: z.string().regex(hexColorRegex, 'Must be hex color #RRGGBB').optional(),
    forced: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      !(
        data.durationMin !== undefined &&
        data.durationMax !== undefined &&
        data.durationMin > data.durationMax
      ),
    { message: 'durationMin must be <= durationMax' },
  )
  // Note: partial updates only validate when BOTH windows are provided
  .refine((data) => !(data.windowStart && data.windowEnd && data.windowStart >= data.windowEnd), {
    message: 'windowStart must be before windowEnd',
  });

export const updateTaskSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    priority: z.number().int().min(1).max(4).optional(),
    totalDuration: z.number().int().positive().max(43200).optional(),
    remainingDuration: z.number().int().nonnegative().max(43200).optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
    earliestStart: z.string().datetime({ offset: true }).optional(),
    chunkMin: z.number().int().positive().max(1440).optional(),
    chunkMax: z.number().int().positive().max(1440).optional(),
    schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
    skipBuffer: z.boolean().optional(),
    calendarId: z.string().uuid().optional(),
    color: z.string().regex(hexColorRegex, 'Must be hex color #RRGGBB').optional(),
    status: z.enum(['open', 'done_scheduling', 'completed']).optional(),
    isUpNext: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      !(
        data.chunkMin !== undefined &&
        data.chunkMax !== undefined &&
        data.chunkMin > data.chunkMax
      ),
    { message: 'chunkMin must be <= chunkMax' },
  )
  .refine(
    (data) =>
      !data.earliestStart || !data.dueDate || new Date(data.earliestStart) < new Date(data.dueDate),
    { message: 'Earliest start must be before due date', path: ['earliestStart'] },
  );

export const updateMeetingSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    priority: z.number().int().min(1).max(4).optional(),
    attendees: z.array(z.string().email()).max(50).optional(),
    duration: z.number().int().positive().max(1440).optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']).optional(),
    idealTime: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
    windowStart: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
    windowEnd: z.string().regex(timeRegex, 'Must be HH:MM format').optional(),
    location: z.string().max(500).optional(),
    conferenceType: z
      .enum(['zoom', 'google_meet', 'teams', 'webex', 'phone', 'in_person', 'other'])
      .optional(),
    skipBuffer: z.boolean().optional(),
    calendarId: z.string().uuid().optional(),
    color: z.string().regex(hexColorRegex, 'Must be hex color #RRGGBB').optional(),
  })
  .refine((data) => !(data.windowStart && data.windowEnd && data.windowStart >= data.windowEnd), {
    message: 'windowStart must be before windowEnd',
  });
export const updateFocusSchema = createFocusSchema.partial();
export const updateBufferSchema = createBufferSchema.partial();

export const moveEventSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .refine((data) => new Date(data.start) < new Date(data.end), {
    message: 'start must be before end',
  });

export const createLinkSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .max(100),
  durations: z.array(z.number().int().positive().max(1440)).min(1).max(20),
  schedulingHours: z.enum(['working', 'personal', 'custom']).optional(),
  priority: z.number().int().min(1).max(4).optional(),
});

export const updateLinkSchema = createLinkSchema
  .extend({
    enabled: z.boolean().optional(),
  })
  .partial();

export const userSettingsSchema = z.object({
  workingHours: z
    .object({
      start: z.string().regex(timeRegex, 'Must be HH:MM format'),
      end: z.string().regex(timeRegex, 'Must be HH:MM format'),
    })
    .optional(),
  personalHours: z
    .object({
      start: z.string().regex(timeRegex, 'Must be HH:MM format'),
      end: z.string().regex(timeRegex, 'Must be HH:MM format'),
    })
    .optional(),
  timezone: timezoneSchema.optional(),
  schedulingWindowDays: z.number().int().positive().max(90).optional(),
  defaultHabitCalendarId: z.string().min(1).max(200).optional(),
  defaultTaskCalendarId: z.string().min(1).max(200).optional(),
  trimCompletedEvents: z.boolean().optional(),
  pastEventRetentionDays: z.number().int().min(1).max(30).optional(),
});

export const bookingAvailabilitySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
    .refine(
      (d) => {
        const parsed = Date.parse(d + 'T12:00:00Z');
        if (isNaN(parsed)) return false;
        const diff = parsed - Date.now();
        return diff >= -86400000 && diff <= 90 * 86400000; // Allow yesterday through 90 days ahead
      },
      { message: 'Date must be a valid date within the booking window' },
    ),
  duration: z.coerce.number().int().positive().max(1440),
});

export const bookingRequestSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    notes: z.string().max(1000).optional(),
  })
  .refine((data) => new Date(data.start) < new Date(data.end), {
    message: 'start must be before end',
  });

export const linkBookingSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
  })
  .refine((data) => new Date(data.start) < new Date(data.end), {
    message: 'End must be after start',
  });

export const createSchedulingTemplateSchema = z
  .object({
    name: z.string().min(1).max(50),
    startTime: z.string().regex(timeRegex, 'Must be HH:MM format'),
    endTime: z.string().regex(timeRegex, 'Must be HH:MM format'),
  })
  .refine((data) => data.startTime < data.endTime, { message: 'startTime must be before endTime' });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const completionSchema = z.object({
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
    .refine((d) => !isNaN(Date.parse(d + 'T12:00:00Z')), {
      message: 'Must be a valid calendar date',
    }),
});

export const createSubtaskSchema = z.object({
  name: z.string().min(1).max(200),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z.enum(['habit', 'task', 'meeting', 'link', 'schedule']).optional(),
});

export const updateSubtaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const forceBodySchema = z.object({
  forced: z.boolean(),
});

export const lockBodySchema = z.object({
  locked: z.boolean(),
});

export const upNextBodySchema = z.object({
  isUpNext: z.boolean(),
});

export const scheduleChangesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.string().datetime({ offset: true }).optional(),
});

// ============================================================
// Auth Schemas
// ============================================================

export const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  name: z.string().min(1).max(100),
  gdprConsent: z.literal(true, { message: 'GDPR consent is required' }),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

export const deleteAccountSchema = z.object({
  confirm: z.literal(true),
  password: z.string().min(1).max(128).optional(),
  email: z.string().email().max(254).optional(),
});
