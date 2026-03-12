import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { DEFAULT_CHUNK_MAX } from '@fluxure/shared';

export const itemTypeEnum = pgEnum('item_type_enum', [
  'habit',
  'task',
  'meeting',
  'focus',
  'external',
]);

export const eventStatusEnum = pgEnum('event_status_enum', ['free', 'busy', 'locked', 'completed']);

export const taskStatusEnum = pgEnum('task_status_enum', ['open', 'done_scheduling', 'completed']);

export const calendarModeEnum = pgEnum('calendar_mode_enum', ['writable', 'locked']);

export const schedulingHoursEnum = pgEnum('scheduling_hours_enum', [
  'working',
  'personal',
  'custom',
]);

export const frequencyEnum = pgEnum('frequency_enum', ['daily', 'weekly', 'monthly', 'custom']);

// ============================================================
// Users
// ============================================================
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').unique().notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    passwordHash: text('password_hash'),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    googleId: text('google_id').unique(),
    googleRefreshToken: text('google_refresh_token'),
    googleSyncToken: text('google_sync_token'),
    settings: jsonb('settings'),
    plan: text('plan').default('free').notNull(),
    stripeCustomerId: text('stripe_customer_id').unique(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    planPeriodEnd: timestamp('plan_period_end', { withTimezone: true, mode: 'string' }),
    billingInterval: text('billing_interval'),
    paymentStatus: text('payment_status'),
    onboardingCompleted: boolean('onboarding_completed').default(false).notNull(),
    gdprConsentAt: timestamp('gdpr_consent_at', { withTimezone: true, mode: 'string' }),
    consentVersion: text('consent_version'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('idx_users_stripe_subscription').on(table.stripeSubscriptionId)],
);

// ============================================================
// Sessions
// ============================================================
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_refresh_token_hash').on(table.refreshTokenHash),
    index('idx_sessions_user_expires').on(table.userId, table.expiresAt),
  ],
);

// ============================================================
// Email Verifications
// ============================================================
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_email_verifications_user_id').on(table.userId),
    index('idx_email_verifications_token_hash').on(table.tokenHash),
  ],
);

// ============================================================
// Password Resets
// ============================================================
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_password_resets_user_id').on(table.userId),
    index('idx_password_resets_token_hash').on(table.tokenHash),
  ],
);

// ============================================================
// Calendars
// ============================================================
export const calendars = pgTable(
  'calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    googleCalendarId: text('google_calendar_id').notNull(),
    name: text('name').notNull(),
    color: text('color').default('#4285f4').notNull(),
    mode: calendarModeEnum('mode').default('writable').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    syncToken: text('sync_token'),
    watchChannelId: text('watch_channel_id'),
    watchResourceId: text('watch_resource_id'),
    watchToken: text('watch_token'),
    watchExpiresAt: timestamp('watch_expires_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_calendars_user_id').on(table.userId),
    index('idx_calendars_watch_channel_id').on(table.watchChannelId),
    index('idx_calendars_user_id_enabled').on(table.userId, table.enabled),
    uniqueIndex('idx_calendars_user_google_cal').on(table.userId, table.googleCalendarId),
  ],
);

// ============================================================
// Habits
// ============================================================
export const habits = pgTable(
  'habits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    priority: integer('priority').default(3).notNull(),
    windowStart: text('window_start').notNull(),
    windowEnd: text('window_end').notNull(),
    idealTime: text('ideal_time').notNull(),
    durationMin: integer('duration_min').notNull(),
    durationMax: integer('duration_max').notNull(),
    days: jsonb('days').notNull().$type<string[]>(),
    schedulingHours: schedulingHoursEnum('scheduling_hours').default('working'),
    forced: boolean('forced').default(false).notNull(),
    autoDecline: boolean('auto_decline').default(false).notNull(),
    dependsOn: text('depends_on'),
    enabled: boolean('enabled').default(true).notNull(),
    skipBuffer: boolean('skip_buffer').default(false).notNull(),
    notifications: boolean('notifications').default(false).notNull(),
    calendarId: uuid('calendar_id').references(() => calendars.id, { onDelete: 'set null' }),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_habits_user_id').on(table.userId),
    index('idx_habits_user_id_enabled').on(table.userId, table.enabled),
    index('idx_habits_user_calendar').on(table.userId, table.calendarId),
    index('idx_habits_name_trgm').using('gin', table.name),
  ],
);

// ============================================================
// Tasks
// ============================================================
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    priority: integer('priority').default(2),
    totalDuration: integer('total_duration').notNull(),
    remainingDuration: integer('remaining_duration').notNull(),
    dueDate: text('due_date'),
    earliestStart: text('earliest_start'),
    chunkMin: integer('chunk_min').default(15),
    chunkMax: integer('chunk_max').default(DEFAULT_CHUNK_MAX),
    schedulingHours: schedulingHoursEnum('scheduling_hours'),
    status: taskStatusEnum('status').default('open'),
    isUpNext: boolean('is_up_next').default(false).notNull(),
    skipBuffer: boolean('skip_buffer').default(false).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    calendarId: uuid('calendar_id').references(() => calendars.id, { onDelete: 'set null' }),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_tasks_user_id').on(table.userId),
    index('idx_tasks_user_id_enabled_status').on(table.userId, table.enabled, table.status),
    index('idx_tasks_user_id_status').on(table.userId, table.status),
    index('idx_tasks_user_calendar').on(table.userId, table.calendarId),
    index('idx_tasks_name_trgm').using('gin', table.name),
  ],
);

// ============================================================
// Smart Meetings
// ============================================================
export const smartMeetings = pgTable(
  'smart_meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    priority: integer('priority').default(2),
    attendees: jsonb('attendees'),
    duration: integer('duration').notNull(),
    frequency: frequencyEnum('frequency').notNull(),
    idealTime: text('ideal_time'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    location: text('location'),
    conferenceType: text('conference_type'),
    skipBuffer: boolean('skip_buffer').default(false).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    calendarId: uuid('calendar_id').references(() => calendars.id, { onDelete: 'set null' }),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_smart_meetings_user_id').on(table.userId),
    index('idx_smart_meetings_user_calendar').on(table.userId, table.calendarId),
    index('idx_smart_meetings_user_enabled').on(table.userId, table.enabled),
    index('idx_smart_meetings_name_trgm').using('gin', table.name),
  ],
);

// ============================================================
// Focus Time Rules
// ============================================================
export const focusTimeRules = pgTable(
  'focus_time_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weeklyTargetMinutes: integer('weekly_target_minutes'),
    dailyTargetMinutes: integer('daily_target_minutes'),
    schedulingHours: schedulingHoursEnum('scheduling_hours'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('idx_focus_time_rules_user_id_unique').on(table.userId)],
);

// ============================================================
// Scheduled Events
// ============================================================
export const scheduledEvents = pgTable(
  'scheduled_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: itemTypeEnum('item_type').notNull(),
    itemId: text('item_id').notNull(),
    title: text('title').notNull(),
    googleEventId: text('google_event_id'),
    calendarId: uuid('calendar_id').references(() => calendars.id, { onDelete: 'set null' }),
    start: timestamp('start', { withTimezone: true, mode: 'string' }).notNull(),
    end: timestamp('end', { withTimezone: true, mode: 'string' }).notNull(),
    status: eventStatusEnum('status').default('free'),
    isAllDay: boolean('is_all_day').default(false).notNull(),
    alternativeSlotsCount: integer('alternative_slots_count'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_scheduled_events_user_id').on(table.userId),
    index('idx_scheduled_events_user_id_end').on(table.userId, table.end),
    index('idx_scheduled_events_user_id_start_end').on(table.userId, table.start, table.end),
    index('idx_scheduled_events_user_id_item_id').on(table.userId, table.itemId),
    index('idx_scheduled_events_user_calendar').on(table.userId, table.calendarId),
  ],
);

// ============================================================
// Calendar Events (cached from external calendars)
// ============================================================
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    googleEventId: text('google_event_id').notNull(),
    title: text('title').notNull(),
    start: timestamp('start', { withTimezone: true, mode: 'string' }).notNull(),
    end: timestamp('end', { withTimezone: true, mode: 'string' }).notNull(),
    status: text('status').default('busy'),
    location: text('location'),
    isAllDay: boolean('is_all_day').default(false).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_calendar_events_user_id').on(table.userId),
    index('idx_calendar_events_user_id_end').on(table.userId, table.end),
    index('idx_calendar_events_user_id_start_end').on(table.userId, table.start, table.end),
    uniqueIndex('idx_calendar_events_user_google_event').on(table.userId, table.googleEventId),
    index('idx_calendar_events_user_calendar').on(table.userId, table.calendarId),
    index('idx_calendar_events_title_trgm').using('gin', table.title),
  ],
);

// ============================================================
// Habit Completions
// ============================================================
export const habitCompletions = pgTable(
  'habit_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    scheduledDate: text('scheduled_date').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_habit_completions_user_id').on(table.userId),
    index('idx_habit_completions_habit_user').on(table.habitId, table.userId),
    index('idx_habit_completions_habit_date').on(table.habitId, table.scheduledDate),
    uniqueIndex('idx_habit_completions_unique').on(
      table.userId,
      table.habitId,
      table.scheduledDate,
    ),
  ],
);

// ============================================================
// Subtasks
// ============================================================
export const subtasks = pgTable(
  'subtasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    completed: boolean('completed').default(false).notNull(),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_subtasks_user_id').on(table.userId),
    index('idx_subtasks_task_id_user_id').on(table.taskId, table.userId),
  ],
);

// ============================================================
// Activity Log
// ============================================================
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_activity_log_user_id').on(table.userId),
    index('idx_activity_log_user_id_entity_type').on(table.userId, table.entityType),
    index('idx_activity_log_created_at').on(table.createdAt),
    index('idx_activity_log_user_id_created_at').on(table.userId, table.createdAt),
  ],
);

// ============================================================
// Schedule Changes (diff log)
// ============================================================
export const scheduleChanges = pgTable(
  'schedule_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operationType: text('operation_type').notNull(),
    itemType: itemTypeEnum('item_type').notNull(),
    itemId: text('item_id').notNull(),
    itemName: text('item_name').notNull(),
    previousStart: timestamp('previous_start', { withTimezone: true, mode: 'string' }),
    previousEnd: timestamp('previous_end', { withTimezone: true, mode: 'string' }),
    newStart: timestamp('new_start', { withTimezone: true, mode: 'string' }),
    newEnd: timestamp('new_end', { withTimezone: true, mode: 'string' }),
    reason: text('reason'),
    batchId: text('batch_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('idx_schedule_changes_user_id').on(table.userId),
    index('idx_schedule_changes_batch_id').on(table.batchId),
    index('idx_schedule_changes_created_at').on(table.createdAt),
    index('idx_schedule_changes_user_id_created_at').on(table.userId, table.createdAt),
  ],
);

// ============================================================
// OAuth States
// ============================================================
export const oauthStates = pgTable(
  'oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    intent: text('intent').default('login').notNull(), // 'login' or 'signup'
  },
  (table) => [index('idx_oauth_states_expires_at').on(table.expiresAt)],
);

// ============================================================
// Scheduling Templates
// ============================================================
export const schedulingTemplates = pgTable(
  'scheduling_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_scheduling_templates_user_id').on(table.userId),
    uniqueIndex('idx_scheduling_templates_user_name').on(table.userId, table.name),
  ],
);

// ============================================================
// Stripe Webhook Events
// ============================================================
export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('idx_stripe_webhook_events_processed_at').on(table.processedAt)],
);

// ============================================================
// Scheduling Links
// ============================================================
export const schedulingLinks = pgTable(
  'scheduling_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').unique().notNull(),
    name: text('name').notNull(),
    durations: jsonb('durations'),
    schedulingHours: schedulingHoursEnum('scheduling_hours'),
    priority: integer('priority').default(3),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('idx_scheduling_links_user_id').on(table.userId)],
);
