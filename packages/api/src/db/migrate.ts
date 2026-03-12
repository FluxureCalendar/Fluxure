import pg from 'pg';
import { createLogger } from '../logger.js';

const log = createLogger('migrate');
const { Pool } = pg;

type Migration = { version: number; description: string; sql: string };

function migrationV1(): Migration {
  return {
    version: 1,
    description: 'Complete schema creation with all constraints, indexes, and extensions',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      -- ============================================================
      -- Custom Enum Types
      -- ============================================================
      DO $$ BEGIN
        CREATE TYPE item_type_enum AS ENUM ('habit', 'task', 'meeting', 'focus', 'external');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE task_status_enum AS ENUM ('open', 'done_scheduling', 'completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE calendar_mode_enum AS ENUM ('writable', 'locked');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE scheduling_hours_enum AS ENUM ('working', 'personal', 'custom');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        CREATE TYPE frequency_enum AS ENUM ('daily', 'weekly', 'monthly', 'custom');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      -- ============================================================
      -- Users
      -- ============================================================
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        password_hash TEXT,
        name TEXT,
        avatar_url TEXT,
        google_id TEXT UNIQUE,
        google_refresh_token TEXT,
        google_sync_token TEXT,
        settings JSONB,
        plan TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT UNIQUE,
        stripe_subscription_id TEXT,
        plan_period_end TIMESTAMPTZ,
        billing_interval TEXT,
        payment_status TEXT,
        onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
        gdpr_consent_at TIMESTAMPTZ,
        consent_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id);

      -- ============================================================
      -- Sessions
      -- ============================================================
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);

      -- ============================================================
      -- Email Verifications
      -- ============================================================
      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verifications_token_hash ON email_verifications(token_hash);

      -- ============================================================
      -- Password Resets
      -- ============================================================
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);

      -- ============================================================
      -- Calendars
      -- ============================================================
      CREATE TABLE IF NOT EXISTS calendars (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_calendar_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#4285f4',
        mode calendar_mode_enum NOT NULL DEFAULT 'writable',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        sync_token TEXT,
        watch_channel_id TEXT,
        watch_resource_id TEXT,
        watch_token TEXT,
        watch_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calendars_user_id ON calendars(user_id);
      CREATE INDEX IF NOT EXISTS idx_calendars_watch_channel_id ON calendars(watch_channel_id);
      CREATE INDEX IF NOT EXISTS idx_calendars_user_id_enabled ON calendars(user_id, enabled);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_user_google_cal ON calendars(user_id, google_calendar_id);

      -- ============================================================
      -- Habits
      -- ============================================================
      CREATE TABLE IF NOT EXISTS habits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 3,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        ideal_time TEXT NOT NULL,
        duration_min INTEGER NOT NULL,
        duration_max INTEGER NOT NULL,
        days JSONB NOT NULL DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb,
        scheduling_hours scheduling_hours_enum DEFAULT 'working',
        forced BOOLEAN NOT NULL DEFAULT FALSE,
        auto_decline BOOLEAN NOT NULL DEFAULT FALSE,
        depends_on TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        skip_buffer BOOLEAN NOT NULL DEFAULT FALSE,
        notifications BOOLEAN NOT NULL DEFAULT FALSE,
        calendar_id UUID REFERENCES calendars(id) ON DELETE SET NULL,
        color TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);
      CREATE INDEX IF NOT EXISTS idx_habits_user_id_enabled ON habits(user_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_habits_user_calendar ON habits(user_id, calendar_id);
      CREATE INDEX IF NOT EXISTS idx_habits_name_trgm ON habits USING GIN (name gin_trgm_ops);

      -- ============================================================
      -- Tasks
      -- ============================================================
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 2,
        total_duration INTEGER NOT NULL,
        remaining_duration INTEGER NOT NULL,
        due_date TEXT,
        earliest_start TEXT,
        chunk_min INTEGER DEFAULT 15,
        chunk_max INTEGER DEFAULT 120,
        scheduling_hours scheduling_hours_enum,
        status task_status_enum DEFAULT 'open',
        is_up_next BOOLEAN NOT NULL DEFAULT FALSE,
        skip_buffer BOOLEAN NOT NULL DEFAULT FALSE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        calendar_id UUID REFERENCES calendars(id) ON DELETE SET NULL,
        color TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id_enabled_status ON tasks(user_id, enabled, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id_status ON tasks(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_calendar ON tasks(user_id, calendar_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_name_trgm ON tasks USING GIN (name gin_trgm_ops);

      -- ============================================================
      -- Smart Meetings
      -- ============================================================
      CREATE TABLE IF NOT EXISTS smart_meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 2,
        attendees JSONB,
        duration INTEGER NOT NULL,
        frequency frequency_enum NOT NULL,
        ideal_time TEXT,
        window_start TEXT,
        window_end TEXT,
        location TEXT,
        conference_type TEXT,
        skip_buffer BOOLEAN NOT NULL DEFAULT FALSE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        calendar_id UUID REFERENCES calendars(id) ON DELETE SET NULL,
        color TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_user_id ON smart_meetings(user_id);
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_user_calendar ON smart_meetings(user_id, calendar_id);
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_user_enabled ON smart_meetings(user_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_name_trgm ON smart_meetings USING GIN (name gin_trgm_ops);

      -- ============================================================
      -- Focus Time Rules
      -- ============================================================
      CREATE TABLE IF NOT EXISTS focus_time_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weekly_target_minutes INTEGER,
        daily_target_minutes INTEGER,
        scheduling_hours scheduling_hours_enum,
        window_start TEXT,
        window_end TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_time_rules_user_id_unique ON focus_time_rules(user_id);

      -- ============================================================
      -- Buffer Config
      -- ============================================================
      CREATE TABLE IF NOT EXISTS buffer_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        travel_time_minutes INTEGER DEFAULT 15,
        decompression_minutes INTEGER DEFAULT 10,
        break_between_items_minutes INTEGER DEFAULT 5,
        apply_decompression_to TEXT DEFAULT 'all',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_buffer_config_user_id_unique ON buffer_config(user_id);

      -- ============================================================
      -- Scheduled Events
      -- ============================================================
      CREATE TABLE IF NOT EXISTS scheduled_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type item_type_enum NOT NULL,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        google_event_id TEXT,
        calendar_id UUID REFERENCES calendars(id) ON DELETE SET NULL,
        start TIMESTAMPTZ NOT NULL,
        "end" TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'free',
        is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
        alternative_slots_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id ON scheduled_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_end ON scheduled_events(user_id, "end");
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_start_end ON scheduled_events(user_id, start, "end");
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_item_id ON scheduled_events(user_id, item_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_calendar ON scheduled_events(user_id, calendar_id);

      -- ============================================================
      -- Calendar Events (cached from external calendars)
      -- ============================================================
      CREATE TABLE IF NOT EXISTS calendar_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        google_event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start TIMESTAMPTZ NOT NULL,
        "end" TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'busy',
        location TEXT,
        is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id_end ON calendar_events(user_id, "end");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id_start_end ON calendar_events(user_id, start, "end");
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_user_google_event ON calendar_events(user_id, google_event_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_calendar ON calendar_events(user_id, calendar_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_title_trgm ON calendar_events USING GIN (title gin_trgm_ops);

      -- ============================================================
      -- Habit Completions
      -- ============================================================
      CREATE TABLE IF NOT EXISTS habit_completions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        scheduled_date TEXT NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_habit_completions_user_id ON habit_completions(user_id);
      CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_user ON habit_completions(habit_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_date ON habit_completions(habit_id, scheduled_date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_completions_unique ON habit_completions(user_id, habit_id, scheduled_date);

      -- ============================================================
      -- Subtasks
      -- ============================================================
      CREATE TABLE IF NOT EXISTS subtasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subtasks_user_id ON subtasks(user_id);
      CREATE INDEX IF NOT EXISTS idx_subtasks_task_id_user_id ON subtasks(task_id, user_id);

      -- ============================================================
      -- Activity Log
      -- ============================================================
      CREATE TABLE IF NOT EXISTS activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id_entity_type ON activity_log(user_id, entity_type);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id_created_at ON activity_log(user_id, created_at);

      -- ============================================================
      -- Schedule Changes (diff log)
      -- ============================================================
      CREATE TABLE IF NOT EXISTS schedule_changes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        item_type item_type_enum NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        previous_start TIMESTAMPTZ,
        previous_end TIMESTAMPTZ,
        new_start TIMESTAMPTZ,
        new_end TIMESTAMPTZ,
        reason TEXT,
        batch_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_id ON schedule_changes(user_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_batch_id ON schedule_changes(batch_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_created_at ON schedule_changes(created_at);
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_id_created_at ON schedule_changes(user_id, created_at);

      -- ============================================================
      -- OAuth States
      -- ============================================================
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL,
        intent TEXT NOT NULL DEFAULT 'login'
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

      -- ============================================================
      -- Scheduling Templates
      -- ============================================================
      CREATE TABLE IF NOT EXISTS scheduling_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduling_templates_user_id ON scheduling_templates(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_templates_user_name ON scheduling_templates(user_id, name);

      -- ============================================================
      -- Stripe Webhook Events
      -- ============================================================
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at ON stripe_webhook_events(processed_at);

      -- ============================================================
      -- Scheduling Links
      -- ============================================================
      CREATE TABLE IF NOT EXISTS scheduling_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        durations JSONB,
        scheduling_hours scheduling_hours_enum,
        priority INTEGER DEFAULT 3,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduling_links_user_id ON scheduling_links(user_id);

      -- ============================================================
      -- Autovacuum tuning for high-churn tables
      -- ============================================================
      ALTER TABLE scheduled_events SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
      ALTER TABLE calendar_events SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
      ALTER TABLE schedule_changes SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
      ALTER TABLE habit_completions SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.1);
    `,
  };
}

function migrationV2(): Migration {
  return {
    version: 2,
    description: 'Convert scheduled_events.status from TEXT to event_status_enum',
    sql: `
      -- Create the event_status_enum type
      DO $$ BEGIN
        CREATE TYPE event_status_enum AS ENUM ('free', 'busy', 'locked', 'completed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      -- Convert existing text column to use the enum
      ALTER TABLE scheduled_events
        ALTER COLUMN status TYPE event_status_enum
        USING status::event_status_enum;

      -- Re-apply the default
      ALTER TABLE scheduled_events
        ALTER COLUMN status SET DEFAULT 'free'::event_status_enum;
    `,
  };
}

function getAllMigrations(): Migration[] {
  return [migrationV1(), migrationV2()];
}

/**
 * Run PostgreSQL schema creation with versioned migrations.
 * Uses CREATE TABLE IF NOT EXISTS for idempotent execution.
 * Tracks applied migrations via schema_migrations table.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('SELECT 1'); // verify connection
    log.info('Connected to PostgreSQL');

    // Ensure the public schema exists (may be missing if schema was dropped)
    await pool.query('CREATE SCHEMA IF NOT EXISTS public');

    // Create schema_migrations table for version tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        description TEXT
      );
    `);

    // Acquire advisory lock to prevent concurrent migration runs
    await pool.query('SELECT pg_advisory_lock(0)');

    // Get already-applied versions
    const appliedResult = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const appliedVersions = new Set(appliedResult.rows.map((r: { version: number }) => r.version));

    const migrations = getAllMigrations();

    // Run each pending migration in a transaction
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      log.info(
        { version: migration.version, description: migration.description },
        'Applying migration',
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, description) VALUES ($1, $2)', [
          migration.version,
          migration.description,
        ]);
        await client.query('COMMIT');
        log.info({ version: migration.version }, 'Migration applied successfully');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    log.info('All migrations up to date');

    // Release advisory lock
    await pool.query('SELECT pg_advisory_unlock(0)');
  } finally {
    await pool.end();
  }
}
