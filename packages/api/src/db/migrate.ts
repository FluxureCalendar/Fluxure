import pg from 'pg';
import { createLogger } from '../logger.js';

const log = createLogger('migrate');
const { Pool } = pg;

type Migration = { version: number; description: string; sql: string };

function migrationV1(): Migration {
  return {
    version: 1,
    description: 'Initial schema creation',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
        onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
        gdpr_consent_at TIMESTAMPTZ,
        consent_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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

      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);

      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

      CREATE TABLE IF NOT EXISTS calendars (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_calendar_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#4285f4',
        mode TEXT DEFAULT 'writable',
        enabled BOOLEAN DEFAULT TRUE,
        sync_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calendars_user_id ON calendars(user_id);

      CREATE TABLE IF NOT EXISTS habits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 3,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        ideal_time TEXT NOT NULL,
        duration_min INTEGER NOT NULL,
        duration_max INTEGER NOT NULL,
        frequency TEXT NOT NULL,
        frequency_config JSONB,
        scheduling_hours TEXT DEFAULT 'working',
        forced BOOLEAN DEFAULT FALSE,
        auto_decline BOOLEAN DEFAULT FALSE,
        depends_on TEXT,
        enabled BOOLEAN DEFAULT TRUE,
        skip_buffer BOOLEAN DEFAULT FALSE,
        notifications BOOLEAN DEFAULT FALSE,
        calendar_id TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);

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
        scheduling_hours TEXT,
        status TEXT DEFAULT 'open',
        is_up_next BOOLEAN DEFAULT FALSE,
        skip_buffer BOOLEAN DEFAULT FALSE,
        calendar_id TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);

      CREATE TABLE IF NOT EXISTS smart_meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 2,
        attendees JSONB,
        duration INTEGER NOT NULL,
        frequency TEXT NOT NULL,
        ideal_time TEXT,
        window_start TEXT,
        window_end TEXT,
        location TEXT,
        conference_type TEXT,
        skip_buffer BOOLEAN DEFAULT FALSE,
        calendar_id TEXT,
        color TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_user_id ON smart_meetings(user_id);

      CREATE TABLE IF NOT EXISTS focus_time_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weekly_target_minutes INTEGER,
        daily_target_minutes INTEGER,
        scheduling_hours TEXT,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_focus_time_rules_user_id ON focus_time_rules(user_id);

      CREATE TABLE IF NOT EXISTS buffer_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        travel_time_minutes INTEGER DEFAULT 15,
        decompression_minutes INTEGER DEFAULT 10,
        break_between_items_minutes INTEGER DEFAULT 5,
        apply_decompression_to TEXT DEFAULT 'all'
      );
      CREATE INDEX IF NOT EXISTS idx_buffer_config_user_id ON buffer_config(user_id);

      CREATE TABLE IF NOT EXISTS scheduled_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT,
        item_id TEXT,
        title TEXT,
        google_event_id TEXT,
        calendar_id TEXT,
        start TEXT,
        "end" TEXT,
        status TEXT DEFAULT 'free',
        is_all_day BOOLEAN DEFAULT FALSE,
        alternative_slots_count INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id ON scheduled_events(user_id);

      CREATE TABLE IF NOT EXISTS calendar_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        calendar_id TEXT NOT NULL,
        google_event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start TEXT NOT NULL,
        "end" TEXT NOT NULL,
        status TEXT DEFAULT 'busy',
        location TEXT,
        is_all_day BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);

      CREATE TABLE IF NOT EXISTS habit_completions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        habit_id TEXT NOT NULL,
        scheduled_date TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_habit_completions_user_id ON habit_completions(user_id);

      CREATE TABLE IF NOT EXISTS subtasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subtasks_user_id ON subtasks(user_id);

      CREATE TABLE IF NOT EXISTS activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);

      CREATE TABLE IF NOT EXISTS schedule_changes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        previous_start TEXT,
        previous_end TEXT,
        new_start TEXT,
        new_end TEXT,
        reason TEXT,
        batch_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_id ON schedule_changes(user_id);

      CREATE TABLE IF NOT EXISTS scheduling_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        durations JSONB,
        scheduling_hours TEXT,
        priority INTEGER DEFAULT 3,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scheduling_links_user_id ON scheduling_links(user_id);
    `,
  };
}

function migrationV2(): Migration {
  return {
    version: 2,
    description: 'Add skip_buffer columns',
    sql: `
      ALTER TABLE habits ADD COLUMN IF NOT EXISTS skip_buffer BOOLEAN DEFAULT FALSE;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS skip_buffer BOOLEAN DEFAULT FALSE;
      ALTER TABLE smart_meetings ADD COLUMN IF NOT EXISTS skip_buffer BOOLEAN DEFAULT FALSE;
    `,
  };
}

function migrationV3(): Migration {
  return {
    version: 3,
    description: 'Add composite indexes on (userId, end) for scheduled_events and calendar_events',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_end ON scheduled_events(user_id, "end");
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id_end ON calendar_events(user_id, "end");
    `,
  };
}

function migrationV4(): Migration {
  return {
    version: 4,
    description: 'Add oauth_states table, unique constraints, and missing indexes',
    sql: `
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_time_rules_user_id_unique ON focus_time_rules(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_buffer_config_user_id_unique ON buffer_config(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_user_google_event ON calendar_events(user_id, google_event_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_batch_id ON schedule_changes(batch_id);
      CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_user ON habit_completions(habit_id, user_id);
    `,
  };
}

function migrationV5(): Migration {
  return {
    version: 5,
    description: 'Add index on oauth_states.expires_at and unique constraint on habit_completions',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_completions_unique ON habit_completions(habit_id, scheduled_date, user_id);
    `,
  };
}

function migrationV6(): Migration {
  return {
    version: 6,
    description: 'Add watch channel columns to calendars for Google push notifications',
    sql: `
      ALTER TABLE calendars ADD COLUMN IF NOT EXISTS watch_channel_id TEXT;
      ALTER TABLE calendars ADD COLUMN IF NOT EXISTS watch_resource_id TEXT;
      ALTER TABLE calendars ADD COLUMN IF NOT EXISTS watch_token TEXT;
      ALTER TABLE calendars ADD COLUMN IF NOT EXISTS watch_expires_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_calendars_watch_channel_id ON calendars (watch_channel_id);
    `,
  };
}

function migrationV7(): Migration {
  return {
    version: 7,
    description: 'Add scheduling_templates table',
    sql: `
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
    `,
  };
}

function migrationV8(): Migration {
  return {
    version: 8,
    description: 'Add performance indexes for scheduling queries and cleanup',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_calendars_user_id_enabled ON calendars(user_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_start_end ON scheduled_events(user_id, start, "end");
      CREATE INDEX IF NOT EXISTS idx_scheduled_events_user_id_item_id ON scheduled_events(user_id, item_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id_start_end ON calendar_events(user_id, start, "end");
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_created_at ON schedule_changes(created_at);
    `,
  };
}

function migrationV9(): Migration {
  return {
    version: 9,
    description:
      'Add performance indexes for sessions, schedule_changes, habit_completions, subtasks, activity_log',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
      CREATE INDEX IF NOT EXISTS idx_schedule_changes_user_id_created_at ON schedule_changes(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_habit_completions_habit_date ON habit_completions(habit_id, scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_subtasks_task_id_user_id ON subtasks(task_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id_entity_type ON activity_log(user_id, entity_type);
    `,
  };
}

function migrationV10(): Migration {
  return {
    version: 10,
    description: 'Rename habits.locked to habits.forced',
    sql: `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='habits' AND column_name='locked') THEN
          ALTER TABLE habits RENAME COLUMN locked TO forced;
        END IF;
      END $$;
    `,
  };
}

function migrationV11(): Migration {
  return {
    version: 11,
    description: 'Add is_primary column to calendars',
    sql: `
      ALTER TABLE calendars ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;
    `,
  };
}

function migrationV12(): Migration {
  return {
    version: 12,
    description: 'Add missing indexes and remove redundant ones',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_email_verifications_token_hash ON email_verifications (token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets (token_hash);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user_calendar ON calendar_events (user_id, calendar_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions (user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log (created_at);
      DROP INDEX IF EXISTS idx_focus_time_rules_user_id;
      DROP INDEX IF EXISTS idx_buffer_config_user_id;
    `,
  };
}

function migrationV13(): Migration {
  return {
    version: 13,
    description: 'Add pg_trgm trigram indexes for search and aggressive autovacuum for hot tables',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS idx_habits_name_trgm ON habits USING GIN (name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_tasks_name_trgm ON tasks USING GIN (name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_smart_meetings_name_trgm ON smart_meetings USING GIN (name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_calendar_events_title_trgm ON calendar_events USING GIN (title gin_trgm_ops);

      ALTER TABLE scheduled_events SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
      ALTER TABLE calendar_events SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
      ALTER TABLE schedule_changes SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
    `,
  };
}

function migrationV14(): Migration {
  return {
    version: 14,
    description:
      'Add NOT NULL constraints to scheduled_events, habits.priority, and calendars columns',
    sql: `
      -- scheduled_events: start, end, title, item_type, item_id should never be null
      UPDATE scheduled_events SET start = '' WHERE start IS NULL;
      UPDATE scheduled_events SET "end" = '' WHERE "end" IS NULL;
      UPDATE scheduled_events SET title = '' WHERE title IS NULL;
      UPDATE scheduled_events SET item_type = '' WHERE item_type IS NULL;
      UPDATE scheduled_events SET item_id = '' WHERE item_id IS NULL;
      ALTER TABLE scheduled_events ALTER COLUMN start SET NOT NULL;
      ALTER TABLE scheduled_events ALTER COLUMN "end" SET NOT NULL;
      ALTER TABLE scheduled_events ALTER COLUMN title SET NOT NULL;
      ALTER TABLE scheduled_events ALTER COLUMN item_type SET NOT NULL;
      ALTER TABLE scheduled_events ALTER COLUMN item_id SET NOT NULL;

      -- habits.priority
      UPDATE habits SET priority = 3 WHERE priority IS NULL;
      ALTER TABLE habits ALTER COLUMN priority SET NOT NULL;

      -- calendars: color, mode, enabled, is_primary
      UPDATE calendars SET color = '#4285f4' WHERE color IS NULL;
      UPDATE calendars SET mode = 'writable' WHERE mode IS NULL;
      UPDATE calendars SET enabled = TRUE WHERE enabled IS NULL;
      UPDATE calendars SET is_primary = FALSE WHERE is_primary IS NULL;
      ALTER TABLE calendars ALTER COLUMN color SET NOT NULL;
      ALTER TABLE calendars ALTER COLUMN mode SET NOT NULL;
      ALTER TABLE calendars ALTER COLUMN enabled SET NOT NULL;
      ALTER TABLE calendars ALTER COLUMN is_primary SET NOT NULL;
    `,
  };
}

function migrationV15(): Migration {
  return {
    version: 15,
    description: 'Add billing columns to users and stripe_webhook_events table',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_period_end TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_interval TEXT;

      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
        ON stripe_webhook_events (processed_at);
    `,
  };
}

function migrationV16(): Migration {
  return {
    version: 16,
    description: 'Add enabled column to tasks and smart_meetings for frozen items',
    sql: `
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE smart_meetings ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
    `,
  };
}

function migrationV17(): Migration {
  return {
    version: 17,
    description: 'Add payment_status column to users for tracking Stripe payment state',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT;
    `,
  };
}

function migrationV18(): Migration {
  return {
    version: 18,
    description: 'Add unique index on habit_completions and composite index on tasks',
    sql: `
      DROP INDEX IF EXISTS idx_habit_completions_unique;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_completions_unique ON habit_completions(user_id, habit_id, scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id_enabled_status ON tasks(user_id, enabled, status);
    `,
  };
}

function migrationV19(): Migration {
  return {
    version: 19,
    description: 'Add composite indexes on habits(userId, enabled) and tasks(userId, status)',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_habits_user_id_enabled ON habits(user_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_id_status ON tasks(user_id, status);
    `,
  };
}

function getAllMigrations(): Migration[] {
  return [
    migrationV1(),
    migrationV2(),
    migrationV3(),
    migrationV4(),
    migrationV5(),
    migrationV6(),
    migrationV7(),
    migrationV8(),
    migrationV9(),
    migrationV10(),
    migrationV11(),
    migrationV12(),
    migrationV13(),
    migrationV14(),
    migrationV15(),
    migrationV16(),
    migrationV17(),
    migrationV18(),
    migrationV19(),
  ];
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

    // Create schema_migrations table for version tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        description TEXT
      );
    `);

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
  } finally {
    await pool.end();
  }
}
