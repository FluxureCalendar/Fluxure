import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users } from '../db/pg-schema.js';
import type { UserSettings } from '@fluxure/shared';
import { getPlanLimits, DEFAULT_SCHEDULING_WINDOW_DAYS } from '@fluxure/shared';
import { cacheGet, cacheSet, cacheDel } from './redis.js';
import { isSelfHosted } from '../config.js';
import { DEFAULT_USER_SETTINGS } from '../routes/defaults.js';

const SETTINGS_TTL_S = 60;

export async function getUserSettingsCached(userId: string): Promise<UserSettings> {
  const cacheKey = `settings:${userId}`;
  const cached = await cacheGet<UserSettings>(cacheKey);
  if (cached) return cached;

  const rows = await db.select().from(users).where(eq(users.id, userId));
  const row = rows[0];
  const settingsRaw = row?.settings;

  // Validate required fields before trusting the JSONB value; fall back to defaults if malformed
  function isValidSettings(v: unknown): v is UserSettings {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    return (
      typeof s.timezone === 'string' &&
      typeof s.schedulingWindowDays === 'number' &&
      s.workingHours !== undefined &&
      s.personalHours !== undefined
    );
  }

  const parsed: UserSettings = isValidSettings(settingsRaw) ? settingsRaw : DEFAULT_USER_SETTINGS;

  // Clamp scheduling window to plan limit
  const limits = getPlanLimits(isSelfHosted() ? 'pro' : (row?.plan ?? 'free'));
  const settings: UserSettings = {
    ...parsed,
    schedulingWindowDays: Math.min(
      parsed.schedulingWindowDays ?? DEFAULT_SCHEDULING_WINDOW_DAYS,
      limits.schedulingWindowDays,
    ),
  };

  await cacheSet(cacheKey, settings, SETTINGS_TTL_S);
  return settings;
}

export async function getUserTimezoneCached(userId: string): Promise<string> {
  const settings = await getUserSettingsCached(userId);
  return settings.timezone || DEFAULT_USER_SETTINGS.timezone;
}

export async function invalidateUserSettingsCache(userId: string): Promise<void> {
  await cacheDel(`settings:${userId}`);
}
