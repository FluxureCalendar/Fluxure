import { Router } from 'express';
import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/pg-index.js';
import {
  schedulingLinks,
  scheduledEvents,
  calendarEvents,
  calendars,
  users,
} from '../db/pg-schema.js';
import type { BookingSlot, BookingConfirmation, BookingLinkInfo } from '@fluxure/shared';
import {
  SchedulingHours,
  BOOKING_SLOT_STEP_MS,
  BOOKING_MIN_LEAD_TIME_MS,
  DEFAULT_BOOKING_DURATIONS,
  RATE_LIMIT,
  AVAILABILITY_CACHE_TTL_S,
  startOfDayInTz,
  nextDayInTz,
  setTimeInTz,
  parseTime,
  toDateStr,
  minutesSinceMidnightInTz,
  parseTimeToMinutes,
  getPlanLimits,
} from '@fluxure/shared';
import { bookingAvailabilitySchema, bookingRequestSchema } from '../validation.js';
import { sendValidationError, sendNotFound, sendError } from './helpers.js';
import { requireAuth } from '../middleware/auth.js';
import { sendBookingConfirmation } from '../auth/email.js';
import { getHoursWindow } from './defaults.js';
import { bookingLimiter, createStore } from '../rate-limiters.js';
import { triggerReschedule } from '../polling-ref.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { cacheGet, cacheSet, cacheDel } from '../cache/redis.js';
import { createLogger } from '../logger.js';

const log = createLogger('booking');

async function getCachedAvailability(key: string): Promise<unknown | null> {
  return cacheGet(key);
}

/** Invalidate all availability cache entries for a user. */
export async function invalidateBookingAvailability(userId: string): Promise<void> {
  await cacheDel(`avail:${userId}:*`);
}

const MAX_AVAILABILITY_SLOTS = 100;
const MAX_BOOKING_RANGE_DAYS = 14;
const MAX_BOOKING_DURATION_MIN = 480;

const VALID_SLUG_RE = /^[a-z0-9-]{1,100}$/;

function validateSlug(slug: string, res: import('express').Response): boolean {
  if (!VALID_SLUG_RE.test(slug)) {
    sendNotFound(res, 'Link');
    return false;
  }
  return true;
}

const router = Router();

const bookingInfoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
  store: createStore('booking-info'),
});

const bookingAvailabilityLimiter = rateLimit({
  ...RATE_LIMIT.bookingAvailability,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many availability requests, please try again later.' },
  store: createStore('booking-availability'),
});

import { getUserSettingsCached as getUserSettingsForLink } from '../cache/user-settings.js';

async function getOccupiedIntervals(
  linkUserId: string,
  dayStart: string,
  dayEnd: string,
): Promise<Array<{ start: number; end: number }>> {
  const [managed, enabledCals] = await Promise.all([
    db
      .select()
      .from(scheduledEvents)
      .where(
        and(
          eq(scheduledEvents.userId, linkUserId),
          gte(scheduledEvents.end, dayStart),
          lte(scheduledEvents.start, dayEnd),
        ),
      ),
    db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.userId, linkUserId), eq(calendars.enabled, true))),
  ]);
  const calIds = enabledCals.map((c) => c.id);

  const external =
    calIds.length > 0
      ? await db
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.userId, linkUserId),
              inArray(calendarEvents.calendarId, calIds),
              eq(calendarEvents.isAllDay, false),
              gte(calendarEvents.end, dayStart),
              lte(calendarEvents.start, dayEnd),
            ),
          )
      : [];

  const occupied: Array<{ start: number; end: number }> = [];

  for (const ev of managed) {
    if (!ev.start || !ev.end) continue;
    occupied.push({ start: new Date(ev.start).getTime(), end: new Date(ev.end).getTime() });
  }
  for (const ev of external) {
    if (!ev.start || !ev.end) continue;
    occupied.push({ start: new Date(ev.start).getTime(), end: new Date(ev.end).getTime() });
  }

  return occupied;
}

/**
 * Get day boundaries in the user's timezone as UTC ISO strings.
 */
function getDayBoundariesInTimezone(
  dateStr: string,
  timezone: string,
): { dayStart: string; dayEnd: string } {
  const refDate = new Date(`${dateStr}T12:00:00Z`); // noon UTC to avoid date-boundary issues
  const dayStartDate = startOfDayInTz(refDate, timezone);
  const dayEndDate = nextDayInTz(refDate, timezone);
  return {
    dayStart: dayStartDate.toISOString(),
    dayEnd: dayEndDate.toISOString(),
  };
}

// GET /api/book/:slug — public link info (no auth required)
router.get(
  '/:slug',
  bookingInfoLimiter,
  asyncHandler(async (req, res) => {
    const slug = req.params.slug as string;
    if (!validateSlug(slug, res)) return;
    const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

    if (linkRows.length === 0) {
      // Return 404 for non-existent slugs
      sendNotFound(res, 'Booking link');
      return;
    }
    const link = linkRows[0];
    if (!link.enabled) {
      // Return 404 for disabled slugs too (prevent enumeration)
      sendNotFound(res, 'Booking link');
      return;
    }

    const userSettings = await getUserSettingsForLink(link.userId);
    const info: BookingLinkInfo = {
      slug: link.slug,
      name: link.name,
      durations: (link.durations ?? [...DEFAULT_BOOKING_DURATIONS]) as number[],
      enabled: true,
      timezone: userSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    res.json(info);
  }),
);

// GET /api/book/:slug/availability?date=YYYY-MM-DD&duration=30
router.get(
  '/:slug/availability',
  bookingAvailabilityLimiter,
  asyncHandler(async (req, res) => {
    const slug = req.params.slug as string;
    if (!validateSlug(slug, res)) return;
    const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

    if (linkRows.length === 0) {
      sendNotFound(res, 'Booking link');
      return;
    }
    const link = linkRows[0];
    if (!link.enabled) {
      // Return 404 for disabled slugs
      sendNotFound(res, 'Booking link');
      return;
    }

    const parsed = bookingAvailabilitySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { date, duration } = parsed.data;
    const configuredDurations: number[] = (link.durations ?? [
      ...DEFAULT_BOOKING_DURATIONS,
    ]) as number[];
    if (!configuredDurations.includes(duration)) {
      sendError(res, 400, 'Invalid duration for this link');
      return;
    }

    const requestedDate = new Date(`${date}T00:00:00Z`);
    const maxDate = new Date();
    maxDate.setUTCDate(maxDate.getUTCDate() + MAX_BOOKING_RANGE_DAYS);
    if (requestedDate.getTime() > maxDate.getTime()) {
      sendError(
        res,
        400,
        `Cannot check availability more than ${MAX_BOOKING_RANGE_DAYS} days ahead`,
      );
      return;
    }

    const cacheKey = `avail:${link.userId}:${slug}:${duration}:${date}`;
    const cachedResult = await getCachedAvailability(cacheKey);
    if (cachedResult) {
      res.json(cachedResult);
      return;
    }

    const [userSettings, ownerRows] = await Promise.all([
      getUserSettingsForLink(link.userId),
      db.select({ plan: users.plan }).from(users).where(eq(users.id, link.userId)),
    ]);
    const ownerPlan = ownerRows[0]?.plan ?? 'free';
    const limits = getPlanLimits(ownerPlan);

    const userTimezone = userSettings.timezone || 'America/New_York';
    const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;
    const hoursWindow = getHoursWindow(schedulingHours, userSettings);

    // Build day boundaries using the link owner's timezone instead of UTC
    const { dayStart, dayEnd } = getDayBoundariesInTimezone(date, userTimezone);

    const occupied = await getOccupiedIntervals(link.userId, dayStart, dayEnd);

    const refDate = new Date(`${date}T12:00:00Z`);
    const windowStartParsed = parseTime(hoursWindow.start) ?? { hours: 9, minutes: 0 };
    const windowEndParsed = parseTime(hoursWindow.end) ?? { hours: 17, minutes: 0 };
    const dayWindowStartMs = setTimeInTz(
      refDate,
      windowStartParsed.hours,
      windowStartParsed.minutes,
      userTimezone,
    ).getTime();
    const dayWindowEndMs = setTimeInTz(
      refDate,
      windowEndParsed.hours,
      windowEndParsed.minutes,
      userTimezone,
    ).getTime();

    const now = Date.now();
    const durationMs = duration * 60 * 1000;
    const slotStepMs = BOOKING_SLOT_STEP_MS;

    // Don't offer slots in the past (30 min buffer)
    const effectiveStartMs = Math.max(dayWindowStartMs, now + BOOKING_MIN_LEAD_TIME_MS);
    const startMs = Math.ceil(effectiveStartMs / slotStepMs) * slotStepMs;

    const slots: BookingSlot[] = [];

    for (
      let slotStart = startMs;
      slotStart + durationMs <= dayWindowEndMs;
      slotStart += slotStepMs
    ) {
      const slotEnd = slotStart + durationMs;
      const overlaps = occupied.some((occ) => slotStart < occ.end && slotEnd > occ.start);
      if (!overlaps) {
        slots.push({
          start: new Date(slotStart).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
      }
    }

    const cappedSlots = slots.slice(0, MAX_AVAILABILITY_SLOTS);
    const response = {
      slug,
      date,
      duration,
      slots: cappedSlots,
      branding: limits.bookingPageBranding,
    };
    await cacheSet(cacheKey, response, AVAILABILITY_CACHE_TTL_S);
    res.json(response);
  }),
);

// POST /api/book/:slug — book a slot (public, no auth required)
router.post(
  '/:slug',
  bookingLimiter,
  asyncHandler(async (req, res) => {
    const slug = req.params.slug as string;
    if (!validateSlug(slug, res)) return;
    const linkRows = await db.select().from(schedulingLinks).where(eq(schedulingLinks.slug, slug));

    if (linkRows.length === 0) {
      sendNotFound(res, 'Booking link');
      return;
    }
    const link = linkRows[0];
    if (!link.enabled) {
      // Return 404 for disabled slugs
      sendNotFound(res, 'Booking link');
      return;
    }

    const parsed = bookingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { start, end, name: rawName, email, notes: rawNotes } = parsed.data;
    // Strip HTML tags from user-provided fields to prevent XSS in calendar titles.
    // Single-pass: strip all angle-bracket tags, then remove residual angle brackets
    // and Unicode bidi/control characters (no iterative loop needed).
    function stripAllHtml(input: string): string {
      // Remove all <...> tag-like sequences in one pass
      let result = input.replace(/<[^>]*>/g, '');
      // Strip any remaining stray angle brackets
      result = result.replace(/[<>]/g, '');
      // Remove Unicode bidi/control characters and null bytes
      // U+200B-U+200F (zero-width spaces, LTR/RTL marks)
      // U+202A-U+202E (bidi embedding/override)
      // U+FEFF (BOM/zero-width no-break space)
      // U+0000 (null byte)
      // eslint-disable-next-line no-control-regex
      result = result.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u0000]/g, '');
      return result.trim();
    }
    const name = stripAllHtml(rawName);
    const notes = rawNotes ? stripAllHtml(rawNotes) || undefined : undefined;
    const startDate = new Date(start);
    const endDate = new Date(end);

    const totalDurationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    if (totalDurationMin > MAX_BOOKING_DURATION_MIN) {
      sendError(res, 400, 'Booking duration exceeds maximum allowed');
      return;
    }

    // Must be in the future
    if (startDate.getTime() <= Date.now()) {
      sendError(res, 400, 'Start time must be in the future');
      return;
    }

    // Duration must match configured durations
    const bookingDurationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    const configuredDurations: number[] = (link.durations ?? []) as number[];
    if (!configuredDurations.includes(bookingDurationMin)) {
      sendError(res, 400, 'Invalid duration');
      return;
    }

    // Validate booking slot falls within configured hours window
    const userSettings = await getUserSettingsForLink(link.userId);
    const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;
    const hoursWindow = getHoursWindow(schedulingHours, userSettings);
    const userTimezone = userSettings.timezone || 'America/New_York';

    const startMinutes = minutesSinceMidnightInTz(startDate, userTimezone);
    const endMinutes = minutesSinceMidnightInTz(endDate, userTimezone);
    const windowStartMinutes = parseTimeToMinutes(hoursWindow.start);
    const windowEndMinutes = parseTimeToMinutes(hoursWindow.end);

    if (windowStartMinutes < 0 || windowEndMinutes < 0) {
      sendError(res, 500, 'Invalid booking hours configuration');
      return;
    }

    if (startMinutes < windowStartMinutes || endMinutes > windowEndMinutes) {
      sendError(res, 400, 'Requested slot is outside available booking hours');
      return;
    }

    // Verify start and end are on the same calendar day in the owner's timezone
    const startDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(startDate);
    const endDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(endDate);
    if (startDay !== endDay) {
      sendError(res, 400, 'Booking must be within a single calendar day');
      return;
    }

    // Wrap availability check + insert in a transaction to prevent double-booking
    const now = new Date().toISOString();
    const bookingTitle = notes ? `Booking: ${name} — ${notes}` : `Booking: ${name}`;
    // NOTE: PII (name, email) in title is intentional — the link owner
    // needs to see who booked the slot in their calendar. This data is only visible
    // to the authenticated link owner and is covered by GDPR cascade deletion.

    // Pre-fetch outside transaction to reduce lock duration
    const dateStr = toDateStr(startDate, userTimezone);
    const { dayStart: dayStartISO, dayEnd: dayEndISO } = getDayBoundariesInTimezone(
      dateStr,
      userTimezone,
    );

    try {
      const inserted = await db.transaction(async (tx) => {
        // User-level advisory lock to serialize all booking transactions for the same user.
        // This prevents concurrent bookings from both passing the external conflict check
        // (calendar_events are not locked with FOR UPDATE, so advisory lock is needed).
        // pg_advisory_xact_lock is released automatically when the transaction commits/aborts.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${link.userId}))`);

        const enabledCals = await tx
          .select({ id: calendars.id })
          .from(calendars)
          .where(and(eq(calendars.userId, link.userId), eq(calendars.enabled, true)));
        const enabledCalIds = enabledCals.map((c) => c.id);

        const managed = await tx
          .select()
          .from(scheduledEvents)
          .where(
            and(
              eq(scheduledEvents.userId, link.userId),
              gte(scheduledEvents.end, dayStartISO),
              lte(scheduledEvents.start, dayEndISO),
            ),
          );

        const hasManagedConflict = managed.some((ev) => {
          if (!ev.start || !ev.end) return false;
          return (
            startDate.getTime() < new Date(ev.end).getTime() &&
            endDate.getTime() > new Date(ev.start).getTime()
          );
        });

        const external =
          enabledCalIds.length > 0
            ? await tx
                .select()
                .from(calendarEvents)
                .where(
                  and(
                    eq(calendarEvents.userId, link.userId),
                    inArray(calendarEvents.calendarId, enabledCalIds),
                    gte(calendarEvents.end, dayStartISO),
                    lte(calendarEvents.start, dayEndISO),
                  ),
                )
            : [];

        const hasExternalConflict = external.some((ev) => {
          if (!ev.start || !ev.end || ev.isAllDay) return false;
          return (
            startDate.getTime() < new Date(ev.end).getTime() &&
            endDate.getTime() > new Date(ev.start).getTime()
          );
        });

        if (hasManagedConflict || hasExternalConflict) {
          throw new Error('SLOT_CONFLICT');
        }

        return await tx
          .insert(scheduledEvents)
          .values({
            userId: link.userId,
            itemType: 'meeting',
            itemId: link.id,
            title: bookingTitle,
            googleEventId: null,
            start,
            end,
            status: 'busy',
            alternativeSlotsCount: null,
          })
          .returning();
      });

      await invalidateBookingAvailability(link.userId);
      triggerReschedule('Booking created', link.userId);

      if (email) {
        const [ownerRow] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, link.userId));
        void sendBookingConfirmation(email, {
          hostName: ownerRow?.name ?? 'Host',
          dateTime: start,
          duration: bookingDurationMin,
          timezone: userTimezone,
        }).catch((err) => log.error({ err }, 'Booking confirmation email failed'));
      }

      const confirmation: BookingConfirmation = {
        id: inserted[0].id,
        slug,
        title: bookingTitle,
        start,
        end,
        duration: bookingDurationMin,
        name,
        email,
        createdAt: now,
      };

      res.status(201).json(confirmation);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'SLOT_CONFLICT') {
        sendError(res, 409, 'This time slot is no longer available. Please choose another.');
        return;
      }
      throw err;
    }
  }),
);

// GET /api/book/:slug/bookings — list bookings for a scheduling link (auth required, link owner only)
router.get(
  '/:slug/bookings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const slug = req.params.slug as string;
    if (!validateSlug(slug, res)) return;

    const linkRows = await db
      .select()
      .from(schedulingLinks)
      .where(and(eq(schedulingLinks.slug, slug), eq(schedulingLinks.userId, req.userId)));

    if (linkRows.length === 0) {
      sendNotFound(res, 'Booking link');
      return;
    }

    const link = linkRows[0];

    // Bookings are stored as scheduled_events with itemId = link.id and itemType = 'meeting'
    const bookings = await db
      .select({
        id: scheduledEvents.id,
        title: scheduledEvents.title,
        start: scheduledEvents.start,
        end: scheduledEvents.end,
        status: scheduledEvents.status,
        createdAt: scheduledEvents.createdAt,
      })
      .from(scheduledEvents)
      .where(
        and(
          eq(scheduledEvents.userId, req.userId),
          eq(scheduledEvents.itemId, link.id),
          eq(scheduledEvents.itemType, 'meeting'),
        ),
      );

    res.json({ slug, bookings });
  }),
);

export default router;
