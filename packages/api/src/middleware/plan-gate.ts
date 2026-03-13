import type { Response } from 'express';
import { isUnlimited } from '@fluxure/shared';

const UPGRADE_MESSAGES: Record<string, string> = {
  maxHabits: 'Upgrade to Pro for unlimited habits',
  maxTasks: 'Upgrade to Pro for unlimited tasks',
  maxMeetings: 'Upgrade to Pro for unlimited meetings',
  meetings: 'Smart meetings are not yet available',
  focusTime: 'Upgrade to Pro to use focus time',
  maxCalendars: 'Upgrade to Pro for unlimited calendars',
  maxSchedulingLinks: 'Upgrade to Pro for unlimited scheduling links',
  maxTemplates: 'Upgrade to Pro for more scheduling templates',
};

export function sendPlanLimitError(
  res: Response,
  limitName: string,
  current: number,
  max: number,
): void {
  res.status(403).json({
    error: 'plan_limit_reached',
    limit: limitName,
    current,
    max,
    upgrade_message: UPGRADE_MESSAGES[limitName] ?? 'Upgrade to Pro to unlock this feature',
    upgrade_url: '/settings#billing',
  });
}

export function checkEntityLimit(currentCount: number, maxLimit: number): boolean {
  if (isUnlimited(maxLimit)) return true;
  return currentCount < maxLimit;
}

export function sendFeatureGated(res: Response, feature: string): void {
  res.status(403).json({
    error: 'feature_not_available',
    feature,
    upgrade_message: `Upgrade to Pro to access ${feature}`,
    upgrade_url: '/settings#billing',
  });
}
