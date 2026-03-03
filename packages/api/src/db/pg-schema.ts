import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================
// Users
// ============================================================
export const users = pgTable('users', {
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
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

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
    mode: text('mode').default('writable').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    syncToken: text('sync_token'),
    watchChannelId: text('watch_channel_id'),
    watchResourceId: text('watch_resource_id'),
    watchToken: text('watch_token'),
    watchExpiresAt: timestamp('watch_expires_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [
    index('idx_calendars_user_id').on(table.userId),
    index('idx_calendars_watch_channel_id').on(table.watchChannelId),
    index('idx_calendars_user_id_enabled').on(table.userId, table.enabled),
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
    frequency: text('frequency').notNull(),
    frequencyConfig: jsonb('frequency_config'),
    schedulingHours: text('scheduling_hours').default('working'),
    forced: boolean('forced').default(false),
    autoDecline: boolean('auto_decline').default(false),
    dependsOn: text('depends_on'),
    enabled: boolean('enabled').default(true),
    skipBuffer: boolean('skip_buffer').default(false),
    notifications: boolean('notifications').default(false),
    calendarId: text('calendar_id'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [
    index('idx_habits_user_id').on(table.userId),
    index('idx_habits_user_id_enabled').on(table.userId, table.enabled),
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
    chunkMax: integer('chunk_max').default(120),
    schedulingHours: text('scheduling_hours'),
    status: text('status').default('open'),
    isUpNext: boolean('is_up_next').default(false),
    skipBuffer: boolean('skip_buffer').default(false),
    enabled: boolean('enabled').default(true).notNull(),
    calendarId: text('calendar_id'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [
    index('idx_tasks_user_id').on(table.userId),
    index('idx_tasks_user_id_enabled_status').on(table.userId, table.enabled, table.status),
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
    frequency: text('frequency').notNull(),
    idealTime: text('ideal_time'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    location: text('location'),
    conferenceType: text('conference_type'),
    skipBuffer: boolean('skip_buffer').default(false),
    enabled: boolean('enabled').default(true).notNull(),
    calendarId: text('calendar_id'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [index('idx_smart_meetings_user_id').on(table.userId)],
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
    schedulingHours: text('scheduling_hours'),
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [uniqueIndex('idx_focus_time_rules_user_id_unique').on(table.userId)],
);

// ============================================================
// Buffer Config
// ============================================================
export const bufferConfig = pgTable(
  'buffer_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    travelTimeMinutes: integer('travel_time_minutes').default(15),
    decompressionMinutes: integer('decompression_minutes').default(10),
    breakBetweenItemsMinutes: integer('break_between_items_minutes').default(5),
    applyDecompressionTo: text('apply_decompression_to').default('all'),
  },
  (table) => [uniqueIndex('idx_buffer_config_user_id_unique').on(table.userId)],
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
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    title: text('title').notNull(),
    googleEventId: text('google_event_id'),
    calendarId: text('calendar_id'),
    start: text('start').notNull(),
    end: text('end').notNull(),
    status: text('status').default('free'),
    isAllDay: boolean('is_all_day').default(false),
    alternativeSlotsCount: integer('alternative_slots_count'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [
    index('idx_scheduled_events_user_id').on(table.userId),
    index('idx_scheduled_events_user_id_end').on(table.userId, table.end),
    index('idx_scheduled_events_user_id_start_end').on(table.userId, table.start, table.end),
    index('idx_scheduled_events_user_id_item_id').on(table.userId, table.itemId),
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
    calendarId: text('calendar_id').notNull(),
    googleEventId: text('google_event_id').notNull(),
    title: text('title').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    status: text('status').default('busy'),
    location: text('location'),
    isAllDay: boolean('is_all_day').default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [
    index('idx_calendar_events_user_id').on(table.userId),
    index('idx_calendar_events_user_id_end').on(table.userId, table.end),
    index('idx_calendar_events_user_id_start_end').on(table.userId, table.start, table.end),
    uniqueIndex('idx_calendar_events_user_google_event').on(table.userId, table.googleEventId),
    index('idx_calendar_events_user_calendar').on(table.userId, table.calendarId),
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
    habitId: text('habit_id').notNull(),
    scheduledDate: text('scheduled_date').notNull(),
    completedAt: text('completed_at').notNull(),
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
    taskId: text('task_id').notNull(),
    name: text('name').notNull(),
    completed: boolean('completed').default(false),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
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
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    itemName: text('item_name').notNull(),
    previousStart: text('previous_start'),
    previousEnd: text('previous_end'),
    newStart: text('new_start'),
    newEnd: text('new_end'),
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
  (table) => [index('idx_scheduling_templates_user_id').on(table.userId)],
);

// ============================================================
// Stripe Webhook Events
// ============================================================
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
});

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
    schedulingHours: text('scheduling_hours'),
    priority: integer('priority').default(3),
    enabled: boolean('enabled').default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  },
  (table) => [index('idx_scheduling_links_user_id').on(table.userId)],
);
