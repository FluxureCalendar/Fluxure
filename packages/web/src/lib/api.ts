import { PUBLIC_API_URL } from '$env/static/public';
import { goto } from '$app/navigation';
import {
  DEFAULT_API_BASE,
  API_ERROR_MESSAGE_MAX_LENGTH,
  BLOB_URL_REVOKE_DELAY_MS,
} from '@fluxure/shared';
import { showToast } from './toast.svelte';
import type {
  Habit,
  CreateHabitRequest,
  Task,
  CreateTaskRequest,
  SmartMeeting,
  CreateMeetingRequest,
  FocusTimeRule,
  BufferConfig,
  CalendarEvent,
  SchedulingLink,
  CreateLinkRequest,
  AnalyticsData,
  UserConfig,
  UserSettings,
  Calendar,
  HabitCompletion,
  Subtask,
  ParsedItem,
  QualityScore,
  ScheduleChange,
} from '@fluxure/shared';
import { CalendarMode } from '@fluxure/shared';

const API_BASE = PUBLIC_API_URL || DEFAULT_API_BASE;

let refreshPromise: Promise<boolean> | null = null;
const retriedPaths = new Set<string>();

// Prevents duplicate in-flight GET requests to the same endpoint
const inFlight = new Map<string, Promise<unknown>>();

export interface RescheduleResult {
  message: string;
  operationsApplied: number;
  unschedulable: Array<{ itemId: string; itemType: string; reason: string }>;
}

export interface AlternativesResult {
  alternatives: Array<{ start: string; end: string; score: number }>;
}

export interface BillingStatus {
  plan: string;
  limits: import('@fluxure/shared').PlanLimits;
  billingInterval: string | null;
  periodEnd: string | null;
  hasSubscription: boolean;
  isTrial: boolean;
  trialDaysRemaining: number | null;
  paymentStatus: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method?.toUpperCase() || 'GET';
  if (method === 'GET') {
    const dedupeKey = path;
    const existing = inFlight.get(dedupeKey);
    if (existing) return existing as Promise<T>;
    const promise = doRequest<T>(path, options).finally(() => inFlight.delete(dedupeKey));
    inFlight.set(dedupeKey, promise);
    return promise;
  }
  return doRequest<T>(path, options);
}

async function doRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) {
    // Try token refresh on 401, then redirect to login if refresh fails
    if (res.status === 401 && !path.startsWith('/auth/') && !retriedPaths.has(path)) {
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
            });
            return refreshRes.ok;
          } catch {
            return false;
          } finally {
            refreshPromise = null;
          }
        })();
      }
      const refreshed = await refreshPromise;
      if (refreshed) {
        retriedPaths.add(path);
        try {
          return await doRequest<T>(path, options);
        } finally {
          retriedPaths.delete(path);
        }
      }
      // Direct goto avoids circular dependency with auth.svelte.ts
      if (typeof window !== 'undefined') {
        goto('/login');
      }
      throw Object.assign(new ApiError('Session expired', 401), { handled: true });
    }
    if (res.status === 403) {
      try {
        const body = await res.json();
        if (body.code === 'EMAIL_NOT_VERIFIED' && typeof window !== 'undefined') {
          goto('/verify-email');
          throw new Error('Email not verified - redirecting');
        }
        if (body.code === 'GDPR_CONSENT_REQUIRED' && typeof window !== 'undefined') {
          goto('/onboarding');
          throw new Error('GDPR consent required - redirecting');
        }
        if (body.error === 'plan_limit_reached') {
          const msg = body.upgrade_message || 'Upgrade to Pro to unlock this feature';
          showToast(msg, 'info');
          throw Object.assign(new ApiError(msg, 403, 'plan_limit_reached'), { handled: true });
        }
        if (body.error === 'feature_not_available') {
          const msg = body.upgrade_message || 'This feature requires a Pro plan';
          showToast(msg, 'info');
          throw Object.assign(new ApiError(msg, 403, 'feature_not_available'), { handled: true });
        }
      } catch (e) {
        if (
          e instanceof Error &&
          (e.message === 'Email not verified - redirecting' ||
            e.message === 'GDPR consent required - redirecting')
        )
          throw e;
        if (e instanceof ApiError) throw e;
        /* no JSON body */
      }
    }
    let message = `API error: ${res.status}`;
    try {
      const body = await res.json();
      const raw = body.error ?? body.message ?? message;
      message =
        raw.length > API_ERROR_MESSAGE_MAX_LENGTH
          ? raw.slice(0, API_ERROR_MESSAGE_MAX_LENGTH) + '...'
          : raw;
    } catch {
      /* no JSON body */
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const habits = {
  list: () => request<Habit[]>('/habits'),
  create: (data: CreateHabitRequest) =>
    request<Habit>('/habits', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateHabitRequest & { forced: boolean; enabled: boolean }>) =>
    request<Habit>(`/habits/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/habits/${id}`, { method: 'DELETE' }),
  force: (id: string, forced: boolean) =>
    request<Habit>(`/habits/${id}/force`, {
      method: 'POST',
      body: JSON.stringify({ forced }),
    }),
  getCompletions: (id: string) => request<HabitCompletion[]>(`/habits/${id}/completions`),
  markComplete: (id: string, scheduledDate: string) =>
    request<HabitCompletion>(`/habits/${id}/completions`, {
      method: 'POST',
      body: JSON.stringify({ scheduledDate }),
    }),
  getStreak: (id: string) =>
    request<{ habitId: string; currentStreak: number }>(`/habits/${id}/streak`),
  getBulkStatus: () =>
    request<Record<string, { streak: number; completions: HabitCompletion[] }>>(
      '/habits/bulk-status',
    ),
};

export const tasks = {
  list: () => request<Task[]>('/tasks'),
  create: (data: CreateTaskRequest) =>
    request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<
      CreateTaskRequest & { remainingDuration: number; status: string; isUpNext: boolean }
    >,
  ) =>
    request<Task>(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  complete: (id: string) => request<Task>(`/tasks/${id}/complete`, { method: 'POST' }),
  setUpNext: (id: string, isUpNext: boolean) =>
    request<Task>(`/tasks/${id}/up-next`, {
      method: 'POST',
      body: JSON.stringify({ isUpNext }),
    }),
  getSubtasks: (id: string) => request<Subtask[]>(`/tasks/${id}/subtasks`),
  getSubtaskCounts: () =>
    request<Record<string, { done: number; total: number }>>('/tasks/subtask-counts'),
  createSubtask: (id: string, name: string) =>
    request<Subtask>(`/tasks/${id}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateSubtask: (
    id: string,
    subtaskId: string,
    data: Partial<{ name: string; completed: boolean; sortOrder: number }>,
  ) =>
    request<Subtask>(`/tasks/${id}/subtasks/${subtaskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSubtask: (id: string, subtaskId: string) =>
    request<void>(`/tasks/${id}/subtasks/${subtaskId}`, { method: 'DELETE' }),
};

export const meetings = {
  list: () => request<SmartMeeting[]>('/meetings'),
  create: (data: CreateMeetingRequest) =>
    request<SmartMeeting>('/meetings', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateMeetingRequest>) =>
    request<SmartMeeting>(`/meetings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/meetings/${id}`, { method: 'DELETE' }),
};

export const focusTime = {
  get: () => request<FocusTimeRule>('/focus-time'),
  update: (data: Partial<FocusTimeRule>) =>
    request<FocusTimeRule>('/focus-time', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

export const buffers = {
  get: () => request<BufferConfig>('/buffers'),
  update: (data: Partial<BufferConfig>) =>
    request<BufferConfig>('/buffers', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

export const schedule = {
  getEvents: (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    return request<CalendarEvent[]>(`/schedule${qs ? '?' + qs : ''}`);
  },
  run: () => request<RescheduleResult>('/schedule/reschedule', { method: 'POST' }),
  export: async (start?: string, end?: string) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/schedule/export${qs ? '?' + qs : ''}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      throw new ApiError(`Export failed: ${res.status}`, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fluxure-schedule.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
  },
  getAlternatives: (itemId: string) =>
    request<AlternativesResult>(`/schedule/${itemId}/alternatives`),
  deleteAllManaged: () =>
    request<{ message: string; googleEventsDeleted: number; localEventsDeleted: number }>(
      '/schedule/managed-events',
      { method: 'DELETE', body: JSON.stringify({ confirm: true }) },
    ),
  moveEvent: (eventId: string, start: string, end: string) =>
    request<{ message: string; eventId: string; start: string; end: string }>(
      `/schedule/${eventId}/move`,
      { method: 'POST', body: JSON.stringify({ start, end }) },
    ),
  lockEvent: (eventId: string, locked: boolean) =>
    request<{ eventId: string; locked: boolean; status: string }>(`/schedule/${eventId}/lock`, {
      method: 'POST',
      body: JSON.stringify({ locked }),
    }),
  complete: (eventId: string) =>
    request<{ message: string; eventId: string }>(`/schedule/${eventId}/complete`, {
      method: 'POST',
    }),
  moveExternalEvent: (eventId: string, start: string, end: string) =>
    request<{ message: string; eventId: string; start: string; end: string }>(
      `/schedule/external/${eventId}/move`,
      { method: 'POST', body: JSON.stringify({ start, end }) },
    ),
  getQuality: (date?: string) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const qs = params.toString();
    return request<QualityScore>(`/schedule/quality${qs ? '?' + qs : ''}`);
  },
  getQualityRange: (start: string, end: string) => {
    const params = new URLSearchParams();
    params.set('start', start);
    params.set('end', end);
    return request<QualityScore[]>(`/schedule/quality-range?${params.toString()}`);
  },
  getChanges: (limit?: number, since?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (since) params.set('since', since);
    const qs = params.toString();
    return request<ScheduleChange[]>(`/schedule/changes${qs ? '?' + qs : ''}`);
  },
};

export const links = {
  list: () => request<SchedulingLink[]>('/links'),
  create: (data: CreateLinkRequest) =>
    request<SchedulingLink>('/links', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateLinkRequest & { enabled: boolean }>) =>
    request<SchedulingLink>(`/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/links/${id}`, { method: 'DELETE' }),
  getBySlug: (slug: string) =>
    request<{ slug: string; slots: Array<{ start: string; end: string; duration: number }> }>(
      `/links/${slug}/slots`,
    ),
};

export const analytics = {
  get: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return request<AnalyticsData>(`/analytics${query ? `?${query}` : ''}`);
  },
  weekly: () =>
    request<{ weeklyBreakdown: AnalyticsData['weeklyBreakdown'] }>('/analytics/daily-breakdown'),
};

export const calendars = {
  list: () => request<Calendar[]>('/calendars'),
  discover: () => request<Calendar[]>('/calendars/discover'),
  update: (id: string, data: { mode?: CalendarMode; enabled?: boolean }) =>
    request<Calendar>(`/calendars/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

export const search = {
  query: (q: string) =>
    request<{ results: Array<{ type: string; id: string; name: string; href: string }> }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),
};

export const settings = {
  get: () => request<UserConfig>('/settings'),
  update: (data: Partial<UserSettings>) =>
    request<UserConfig>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  connectGoogle: () => request<{ redirectUrl: string }>('/auth/google'),
  disconnectGoogle: () => request<void>('/settings/google/disconnect', { method: 'POST' }),
  getGoogleStatus: () => request<{ connected: boolean }>('/auth/google/status'),
  completeOnboarding: () =>
    request<{ onboardingCompleted: boolean }>('/settings/onboarding/complete', { method: 'POST' }),
};

export interface QuickAddResult {
  created: boolean;
  type: 'habit' | 'task' | 'meeting';
  item?: unknown;
  parsed: ParsedItem;
  error?: string;
}

export const quickAdd = {
  parse: (input: string) =>
    request<QuickAddResult>('/quick-add', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
};

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface SchedulingTemplate {
  id: string;
  userId: string;
  name: string;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export const schedulingTemplates = {
  list: () => request<{ templates: SchedulingTemplate[] }>('/scheduling-templates'),
  create: (data: { name: string; startTime: string; endTime: string }) =>
    request<{ template: SchedulingTemplate }>('/scheduling-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/scheduling-templates/${id}`, { method: 'DELETE' }),
};

export const billing = {
  status: () => request<BillingStatus>('/billing/status'),
  checkout: (interval: 'monthly' | 'annual') =>
    request<{ url: string }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ interval }),
    }),
  portal: () => request<{ url: string }>('/billing/portal', { method: 'POST' }),
};

export const auth = {
  login: (email: string, password: string) =>
    request<{
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        onboardingCompleted: boolean;
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signup: (name: string, email: string, password: string, gdprConsent = true) =>
    request<{
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        onboardingCompleted: boolean;
      };
      requiresVerification: boolean;
    }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, gdprConsent }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  refresh: () => request<{ success: boolean }>('/auth/refresh', { method: 'POST' }),
  me: () =>
    request<{
      user: {
        id: string;
        name: string;
        email: string;
        avatarUrl: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
        plan: string;
        onboardingCompleted: boolean;
      };
    }>('/auth/me'),
  verifyEmail: (token: string) =>
    request<void>(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'GET',
    }),
  resendVerification: (email: string) =>
    request<void>('/auth/resend-verification-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  forgotPassword: (email: string) =>
    request<void>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<void>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  requestExport: (categories: string[]) =>
    request<{ success: boolean; message: string }>('/auth/export-request', {
      method: 'POST',
      body: JSON.stringify({ categories }),
    }),
  deleteAccount: (password?: string, email?: string) =>
    request<{ success: boolean; message: string }>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, password, email }),
    }),
  getSessions: () => request<{ sessions: SessionInfo[] }>('/auth/sessions'),
  revokeSession: (id: string) =>
    request<{ success: boolean; message: string }>(`/auth/sessions/${id}`, {
      method: 'DELETE',
    }),
  revokeOtherSessions: () =>
    request<{ success: boolean; message: string }>('/auth/sessions', {
      method: 'DELETE',
    }),
  withdrawConsent: () =>
    request<{ success: boolean; message: string }>('/auth/consent/withdraw', {
      method: 'POST',
    }),
};
