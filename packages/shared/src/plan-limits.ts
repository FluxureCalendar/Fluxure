export const PLAN_TYPES = ['free', 'pro'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export interface PlanLimits {
  readonly maxHabits: number;
  readonly maxTasks: number;
  readonly maxMeetings: number;
  readonly maxFocusRules: number;
  readonly maxCalendars: number;
  readonly maxSchedulingLinks: number;
  readonly maxTemplates: number;
  readonly schedulingWindowDays: number;
  readonly analyticsEnabled: boolean;
  readonly analyticsMaxDays: number;
  readonly changeHistoryDays: number;
  readonly activityLogEnabled: boolean;
  readonly qualityScoreBreakdown: boolean;
  readonly qualityScoreTrend: boolean;
  readonly bookingPageBranding: boolean;
  readonly pushNotifications: boolean;
  readonly prioritySupport: boolean;
}

// -1 means unlimited; use isUnlimited() to check
export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxHabits: 3,
    maxTasks: 5,
    maxMeetings: 2,
    maxFocusRules: 1,
    maxCalendars: 1,
    maxSchedulingLinks: 1,
    maxTemplates: 2,
    schedulingWindowDays: 14,
    analyticsEnabled: false,
    analyticsMaxDays: 0,
    changeHistoryDays: 1,
    activityLogEnabled: false,
    qualityScoreBreakdown: false,
    qualityScoreTrend: false,
    bookingPageBranding: true,
    pushNotifications: false,
    prioritySupport: false,
  },
  pro: {
    maxHabits: -1,
    maxTasks: -1,
    maxMeetings: -1,
    maxFocusRules: -1,
    maxCalendars: -1,
    maxSchedulingLinks: -1,
    maxTemplates: 8,
    schedulingWindowDays: 90,
    analyticsEnabled: true,
    analyticsMaxDays: 365,
    changeHistoryDays: 30,
    activityLogEnabled: true,
    qualityScoreBreakdown: true,
    qualityScoreTrend: true,
    bookingPageBranding: false,
    pushNotifications: true,
    prioritySupport: true,
  },
};

export function isUnlimited(limit: number): boolean {
  return limit === -1;
}

export function getPlanLimits(plan: string): PlanLimits {
  if (plan in PLAN_LIMITS) {
    return PLAN_LIMITS[plan as PlanType];
  }
  return PLAN_LIMITS.free;
}
