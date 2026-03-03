import { ItemType } from './types.js';

export const BRAND = {
  name: 'Fluxure',
  tagline: 'Your calendar, intelligently managed',
  description:
    'Fluxure automatically schedules your habits, tasks, and focus time around your existing calendar. Open-source, self-hostable.',
} as const;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_HOUR = 60;
export const DAYS_PER_WEEK = 7;

// Event title prefixes for Google Calendar
export const STATUS_PREFIX = {
  free: '\u{1F7E2}', // green circle
  busy: '\u{1F6E1}\uFE0F', // shield
  locked: '\u{1F512}', // lock
  completed: '\u{2705}', // white check mark
} as const;

// Extended properties stored on Google Calendar events for round-trip identification
export const EXTENDED_PROPS = {
  fluxureId: 'fluxureId',
  itemType: 'fluxureItemType',
  itemId: 'fluxureItemId',
  status: 'fluxureStatus',
  lastModifiedByUs: 'fluxureLastModified',
} as const;

// Default polling interval; overridden by POLL_INTERVAL_MS env var in API
export const POLL_INTERVAL_MS = MS_PER_MINUTE;

// Safety net polling when push notifications are active (Google doesn't guarantee delivery)
export const PUSH_FALLBACK_POLL_MS = 30 * MS_PER_MINUTE;

// Renew watch channels when less than this time remains before expiry
export const WATCH_RENEWAL_BUFFER_MS = 12 * MS_PER_HOUR;

export const SYNC_LOOKBACK_DAYS = 7;
export const SYNC_LOOKAHEAD_DAYS = 30;
export const NUKE_LOOKBACK_DAYS = 90;
export const NUKE_LOOKAHEAD_DAYS = 365;

export const GOOGLE_MAX_RETRIES = 3;
export const GOOGLE_MAX_RETRY_DELAY_MS = 30_000;
export const GOOGLE_MAX_DELETE_RETRIES = 3;
export const GOOGLE_INTER_DELETE_DELAY_MS = 100;

export const DEFAULT_WATCH_TTL_MS = 7 * MS_PER_DAY;
export const MAX_EVENTS_CACHE = 10_000;

/** Maximum number of events to fetch during a single syncEvents call.
 *  Prevents unbounded memory usage and API quota exhaustion. */
export const MAX_SYNC_EVENTS = 10_000;

// Type ordering within same priority level (lower = scheduled first)
export const TYPE_ORDER: Record<ItemType, number> = {
  [ItemType.Meeting]: 0,
  [ItemType.Habit]: 1,
  [ItemType.Task]: 2,
  [ItemType.Focus]: 3,
};

// Thresholds for flipping events from Free to Busy status
export const FLIP_THRESHOLDS = {
  minAlternativeSlots: 2, // flip to Busy when fewer alternatives
  hoursBeforeStart: 2, // flip to Busy when this close to start
} as const;

export const DEFAULT_SCHEDULING_WINDOW_DAYS = 14;

export const DEFAULT_WORKING_HOURS = {
  start: '09:00',
  end: '17:00',
};

export const DEFAULT_PERSONAL_HOURS = {
  start: '07:00',
  end: '22:00',
};

export const MAX_SCHEDULING_WINDOW_DAYS = 90;
export const CANDIDATE_STEP_MINUTES = 30;
export const DEFAULT_FOCUS_BLOCK_MINUTES = 60;
export const FOCUS_TIME_RISK_MULTIPLIER = 1.5;
export const DEFAULT_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export const DEFAULT_WEEKLY_DAY = ['mon'] as const;
export const MONTH_WEEK_MIN = 1;
export const MONTH_WEEK_MAX = 5;

export const MONDAY = 1;
export const FRIDAY = 5;

export const QUALITY_WEIGHTS = {
  placement: 0.3,
  idealTime: 0.25,
  focus: 0.2,
  buffers: 0.15,
  priorities: 0.1,
} as const;

// Invariant: quality weights must sum to 1.0
const _qualityWeightSum =
  QUALITY_WEIGHTS.placement +
  QUALITY_WEIGHTS.idealTime +
  QUALITY_WEIGHTS.focus +
  QUALITY_WEIGHTS.buffers +
  QUALITY_WEIGHTS.priorities;
if (Math.abs(_qualityWeightSum - 1.0) > 1e-9) {
  throw new Error(`QUALITY_WEIGHTS must sum to 1.0, got ${_qualityWeightSum}`);
}

export const QUALITY_IDEAL_MAX_DIFF_MINUTES = 120;
export const QUALITY_IDEAL_CLOSE_MINUTES = 30;
export const QUALITY_IDEAL_FAR_MINUTES = 120;

export const SCORE_WEIGHTS = {
  idealWithPref: { ideal: 55, buffer: 20, continuity: 20, tod: 5 },
  idealDefault: { ideal: 40, buffer: 25, continuity: 20, tod: 15 },
} as const;

export const IDEAL_TIME_SIGMA_USER_SET = 45;
export const IDEAL_TIME_SIGMA_AUTO = 75;
export const BUFFER_IDEAL_GAP_MULTIPLIER = 2;
export const CONTINUITY_NEUTRAL_SCORE = 0.5;
export const CONTINUITY_MAX_GAP_MINUTES = 240;
export const TOD_BELL_CENTER = 0.3;
export const TOD_BELL_SPREAD = 0.5;

export const ACCESS_TOKEN_EXPIRY = '15m';
export const ACCESS_TOKEN_MAX_AGE_MS = 15 * MS_PER_MINUTE;
export const REFRESH_TOKEN_EXPIRY_MS = 7 * MS_PER_DAY;
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';
export const BCRYPT_ROUNDS = 12;
export const MIN_JWT_SECRET_LENGTH = 32;
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm' as const;
export const EMAIL_VERIFICATION_EXPIRY_MS = 24 * MS_PER_HOUR;
export const PASSWORD_RESET_EXPIRY_MS = 1 * MS_PER_HOUR;
export const OAUTH_STATE_TTL_MS = 10 * MS_PER_MINUTE;
export const OAUTH_STATE_CLEANUP_INTERVAL_MS = 60_000;
export const GDPR_CONSENT_VERSION = '1.0';

export const RATE_LIMIT = {
  global: { windowMs: MS_PER_MINUTE, max: 100 },
  webhook: { windowMs: MS_PER_MINUTE, max: 300 },
  reschedule: { windowMs: MS_PER_MINUTE, max: 10 },
  oauth: { windowMs: 15 * MS_PER_MINUTE, max: 10 },
  signup: { windowMs: 15 * MS_PER_MINUTE, max: 5 },
  login: { windowMs: 15 * MS_PER_MINUTE, max: 10 },
  forgotPassword: { windowMs: 15 * MS_PER_MINUTE, max: 3 },
  resetPassword: { windowMs: 15 * MS_PER_MINUTE, max: 5 },
  verifyEmail: { windowMs: 15 * MS_PER_MINUTE, max: 10 },
  changePassword: { windowMs: 15 * MS_PER_MINUTE, max: 5 },
  refresh: { windowMs: 15 * MS_PER_MINUTE, max: 20 },
  dataExport: { windowMs: MS_PER_HOUR, max: 1 },
  bookingAvailability: { windowMs: MS_PER_MINUTE, max: 30 },
  bookingSubmit: { windowMs: MS_PER_MINUTE, max: 10 },
  alternatives: { windowMs: MS_PER_MINUTE, max: 10 },
} as const;

export const WS_PATH = '/ws';
export const WS_IP_RATE_WINDOW_MS = 60_000;
export const WS_IP_RATE_MAX = 10;
export const WS_MAX_CONNECTIONS_PER_USER = 5;
export const WS_MAX_TOTAL_CONNECTIONS = 5000;
export const WS_IP_CLEANUP_INTERVAL_MS = 5 * MS_PER_MINUTE;
export const WS_COMPRESSION_LEVEL = 1;
export const WS_COMPRESSION_THRESHOLD = 128;
export const WS_HEARTBEAT_BASE_MS = 30_000;
export const WS_HEARTBEAT_JITTER_MS = 5_000;
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_TOO_MANY = 4429;
export const WS_BROADCAST_DEBOUNCE_MS = 300;

export const WS_INITIAL_RECONNECT_DELAY_MS = 1000;
export const WS_MAX_RECONNECT_DELAY_MS = 30_000;
export const WS_CAPACITY_MIN_RECONNECT_MS = 10_000;
export const WS_RECONNECT_JITTER_MS = 3000;

export const PG_POOL_MAX_DEFAULT = 50;
export const PG_IDLE_TIMEOUT_MS_DEFAULT = 30_000;
export const PG_CONNECT_TIMEOUT_MS_DEFAULT = 5_000;
export const PG_STATEMENT_TIMEOUT_MS_DEFAULT = 30_000;
export const REDIS_MAX_RETRIES_DEFAULT = 3;
export const REDIS_CONNECT_TIMEOUT_MS_DEFAULT = 5_000;
export const SCHEDULE_CHANGES_RETENTION_DAYS_DEFAULT = 30;

export const BOOKING_SLOT_STEP_MS = 15 * MS_PER_MINUTE;
export const BOOKING_MIN_LEAD_TIME_MS = 30 * MS_PER_MINUTE;
export const BOOKING_WINDOW_DAYS = 7;
export const BOOKING_DATE_RANGE_DAYS = 14;
export const DEFAULT_BOOKING_DURATIONS = [30] as const;
export const MAX_TEMPLATES_PER_USER = 8;
export const MAX_ANALYTICS_RANGE_DAYS = 365;
export const DEFAULT_ANALYTICS_RANGE_MS = 30 * MS_PER_DAY;

export const COLOR_PALETTE = [
  '#4285f4',
  '#ea4335',
  '#34a853',
  '#fbbc04',
  '#ff6d01',
  '#46bdc6',
  '#7b61ff',
  '#e91e63',
] as const;

export const COLOR_NAMES: Record<string, string> = {
  '#4285f4': 'Blue',
  '#ea4335': 'Red',
  '#34a853': 'Green',
  '#fbbc04': 'Yellow',
  '#ff6d01': 'Orange',
  '#46bdc6': 'Teal',
  '#7b61ff': 'Purple',
  '#e91e63': 'Pink',
};

export const TIME_TICK_INTERVAL_MS = 60_000;
export const TOAST_DEFAULT_DURATION_MS = 3000;
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 300;
export const COPY_FEEDBACK_DURATION_MS = 2000;
export const BLOB_URL_REVOKE_DELAY_MS = 1000;
export const API_ERROR_MESSAGE_MAX_LENGTH = 200;
export const HOUR_HEIGHT_PX = 60;
export const DRAG_THRESHOLD_PX = 5;
export const RESIZE_EDGE_PX = 6;
export const MIN_EVENT_DURATION_HOURS = 0.25;
export const MAX_VISIBLE_ATTENDEES = 3;

export const DEFAULT_TIMEZONE = 'America/New_York';
export const DEFAULT_PAST_EVENT_RETENTION_DAYS = 3;
export const DEFAULT_TRAVEL_TIME_MINUTES = 15;
export const DEFAULT_DECOMPRESSION_MINUTES = 5;
export const DEFAULT_BREAK_BETWEEN_MINUTES = 10;
export const DEFAULT_TASK_DURATION = 60;
export const DEFAULT_CHUNK_MIN = 15;
export const DEFAULT_CHUNK_MAX = 60;
export const DEFAULT_MEETING_DURATION = 30;
export const DEFAULT_HABIT_DURATION_MIN = 5;
export const DEFAULT_HABIT_DURATION_MAX = 480;
export const SCHEDULING_WINDOW_MIN_DAYS = 1;
export const SCHEDULING_WINDOW_MAX_DAYS = 90;
export const PAST_EVENT_RETENTION_MIN_DAYS = 1;
export const PAST_EVENT_RETENTION_MAX_DAYS = 30;

export const DEFAULT_BUFFER_CONFIG = {
  travelTimeMinutes: DEFAULT_TRAVEL_TIME_MINUTES,
  decompressionMinutes: DEFAULT_DECOMPRESSION_MINUTES,
  breakBetweenItemsMinutes: DEFAULT_BREAK_BETWEEN_MINUTES,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_STRONG_LENGTH = 12;
export const BOOKING_NAME_MAX_LENGTH = 200;
export const BOOKING_EMAIL_MAX_LENGTH = 254;
export const BOOKING_NOTES_MAX_LENGTH = 1000;
export const SLUG_PATTERN = /^[a-z0-9-]+$/;

export const DEFAULT_PORT = 3000;
export const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';
export const DEFAULT_APP_URL = 'http://localhost:5173';
export const DEFAULT_API_BASE = '/api';
export const DEFAULT_JSON_BODY_LIMIT = '64kb';
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_LOG_LEVEL_DEV = 'debug';
export const DEFAULT_WORKER_POOL_SIZE = 2;
export const DEFAULT_SMTP_PORT = 587;
export const DEFAULT_SMTP_FROM = 'noreply@fluxure.app';
export const DEFAULT_GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
export const WATCH_RENEWAL_CHECK_MS_DEFAULT = 6 * MS_PER_HOUR;

export const SCHEDULER_BOOT_CONCURRENCY = 10;
export const MIN_SCHEDULE_CHANGE_MS = 2 * MS_PER_MINUTE;
export const SCHEDULE_LOOKBACK_MS = MS_PER_DAY;

export const QUALITY_CACHE_TTL_S = 5 * 60;
export const AVAILABILITY_CACHE_TTL_S = 30 * 60;
