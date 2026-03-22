import archiver from 'archiver';
// @ts-expect-error — CJS package, no type declarations
import ZipEncrypted from 'archiver-zip-encrypted';

archiver.registerFormat('zip-encrypted', ZipEncrypted);
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { PassThrough } from 'stream';
import { db } from '../db/pg-index.js';
import {
  users,
  habits,
  tasks,
  subtasks,
  smartMeetings,
  focusTimeRules,
  calendars,
  scheduledEvents,
  calendarEvents,
  habitCompletions,
  activityLog,
  scheduleChanges,
  schedulingLinks,
  schedulingTemplates,
} from '../db/pg-schema.js';
import { sendDataExportEmail } from '../auth/email.js';
import { createLogger } from '../logger.js';

const log = createLogger('data-export');

export type ExportCategory =
  | 'profile'
  | 'habits'
  | 'tasks'
  | 'meetings'
  | 'focus'
  | 'calendars'
  | 'calendarEvents'
  | 'scheduledEvents'
  | 'habitCompletions'
  | 'activityLog'
  | 'scheduleChanges'
  | 'schedulingLinks'
  | 'schedulingTemplates';

export const EXPORT_CATEGORIES: readonly ExportCategory[] = [
  'profile',
  'habits',
  'tasks',
  'meetings',
  'focus',
  'calendars',
  'calendarEvents',
  'scheduledEvents',
  'habitCompletions',
  'activityLog',
  'scheduleChanges',
  'schedulingLinks',
  'schedulingTemplates',
] as const;

const CHUNK_SIZE = 1000;

/** Fetch all rows from a table in chunks to avoid loading everything at once. */
async function fetchChunked<T>(
  queryFn: (limit: number, offset: number) => Promise<T[]>,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  while (true) {
    const chunk = await queryFn(CHUNK_SIZE, offset);
    results.push(...chunk);
    if (chunk.length < CHUNK_SIZE) break;
    offset += CHUNK_SIZE;
  }
  return results;
}

interface CategoryFetcher {
  readonly fetch: (userId: string) => Promise<unknown>;
}

function buildCategoryFetchers(): Record<ExportCategory, CategoryFetcher> {
  return {
    profile: {
      async fetch(userId: string) {
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (!user) return null;
        return {
          user: {
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified,
            plan: user.plan,
            gdprConsentAt: user.gdprConsentAt,
            createdAt: user.createdAt,
          },
          settings: user.settings,
        };
      },
    },
    habits: {
      fetch: (userId) => db.select().from(habits).where(eq(habits.userId, userId)),
    },
    tasks: {
      async fetch(userId: string) {
        const [userTasks, userSubtasks] = await Promise.all([
          db.select().from(tasks).where(eq(tasks.userId, userId)),
          fetchChunked((limit, offset) =>
            db
              .select()
              .from(subtasks)
              .where(eq(subtasks.userId, userId))
              .limit(limit)
              .offset(offset),
          ),
        ]);
        return { tasks: userTasks, subtasks: userSubtasks };
      },
    },
    meetings: {
      fetch: (userId) => db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId)),
    },
    focus: {
      fetch: (userId) => db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId)),
    },
    calendars: {
      async fetch(userId: string) {
        const rows = await db.select().from(calendars).where(eq(calendars.userId, userId));
        return rows.map((c) => ({
          id: c.id,
          userId: c.userId,
          googleCalendarId: c.googleCalendarId,
          name: c.name,
          color: c.color,
          mode: c.mode,
          enabled: c.enabled,
          isPrimary: c.isPrimary,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));
      },
    },
    calendarEvents: {
      fetch: (userId) =>
        fetchChunked((limit, offset) =>
          db
            .select()
            .from(calendarEvents)
            .where(eq(calendarEvents.userId, userId))
            .limit(limit)
            .offset(offset),
        ),
    },
    scheduledEvents: {
      fetch: (userId) =>
        fetchChunked((limit, offset) =>
          db
            .select()
            .from(scheduledEvents)
            .where(eq(scheduledEvents.userId, userId))
            .limit(limit)
            .offset(offset),
        ),
    },
    habitCompletions: {
      fetch: (userId) =>
        fetchChunked((limit, offset) =>
          db
            .select()
            .from(habitCompletions)
            .where(eq(habitCompletions.userId, userId))
            .limit(limit)
            .offset(offset),
        ),
    },
    activityLog: {
      fetch: (userId) =>
        fetchChunked((limit, offset) =>
          db
            .select()
            .from(activityLog)
            .where(eq(activityLog.userId, userId))
            .limit(limit)
            .offset(offset),
        ),
    },
    scheduleChanges: {
      fetch: (userId) =>
        fetchChunked((limit, offset) =>
          db
            .select()
            .from(scheduleChanges)
            .where(eq(scheduleChanges.userId, userId))
            .limit(limit)
            .offset(offset),
        ),
    },
    schedulingLinks: {
      fetch: (userId) =>
        db.select().from(schedulingLinks).where(eq(schedulingLinks.userId, userId)),
    },
    schedulingTemplates: {
      fetch: (userId) =>
        db.select().from(schedulingTemplates).where(eq(schedulingTemplates.userId, userId)),
    },
  };
}

async function buildExportData(
  userId: string,
  categories: readonly ExportCategory[],
): Promise<Record<string, unknown>> {
  const fetchers = buildCategoryFetchers();
  const results = await Promise.all(
    categories.map(async (cat) => {
      const data = await fetchers[cat].fetch(userId);
      return [cat, data] as const;
    }),
  );

  const exportData: Record<string, unknown> = {
    exportDate: new Date().toISOString(),
    categories: [...categories],
  };

  for (const [cat, data] of results) {
    exportData[cat] = data;
  }

  return exportData;
}

async function createEncryptedZip(jsonContent: string, password: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);

    const archive = archiver.create('zip-encrypted', {
      zlib: { level: 9 },
      encryptionMethod: 'aes256',
      password,
    } as archiver.ArchiverOptions);

    archive.on('error', reject);
    archive.pipe(passThrough);
    archive.append(jsonContent, { name: 'fluxure-data-export.json' });
    archive.finalize();
  });
}

const DATA_EXPORT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function processDataExport(
  userId: string,
  categories: readonly ExportCategory[],
): Promise<void> {
  log.info({ userId, categories }, 'Starting data export');

  try {
    const result = await Promise.race([
      (async () => {
        // Look up email from DB to avoid storing PII in job payloads
        const [user] = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId));
        if (!user) {
          log.error({ userId }, 'Data export failed: user not found');
          return;
        }

        const exportData = await buildExportData(userId, categories);
        const jsonContent = JSON.stringify(exportData, null, 2);
        const zipPassword = randomBytes(16).toString('hex'); // 128 bits of entropy
        const zipBuffer = await createEncryptedZip(jsonContent, zipPassword);

        await sendDataExportEmail(user.email, zipBuffer, zipPassword);
        log.info({ userId }, 'Data export email sent successfully');
        return 'ok' as const;
      })(),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), DATA_EXPORT_TIMEOUT_MS),
      ),
    ]);

    if (result === 'timeout') {
      log.error({ userId }, 'Data export timed out after 5 minutes');
    }
  } catch (err) {
    log.error({ userId, err }, 'Data export failed');
  }
}
