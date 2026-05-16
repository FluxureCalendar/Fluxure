import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { users } from '../db/pg-schema.js';
import { getTrialDaysRemaining } from './trial.js';
import { sendTrialEndingEmail } from '../auth/email.js';
import { createLogger } from '../logger.js';

const log = createLogger('trial-warnings');

/**
 * Email trial users approaching expiry. Stage advance is conditional so each
 * reminder is sent exactly once even if this runs more than once per day.
 * Stage: 0 none, 1 day-3 sent, 2 day-1 sent, 3 expired sent.
 */
export async function sendTrialWarnings(): Promise<number> {
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      planPeriodEnd: users.planPeriodEnd,
      trialWarningStage: users.trialWarningStage,
    })
    .from(users)
    .where(
      and(
        eq(users.plan, 'pro'),
        isNull(users.stripeSubscriptionId),
        isNotNull(users.planPeriodEnd),
      ),
    );

  let sent = 0;
  for (const u of candidates) {
    const days = getTrialDaysRemaining(u.planPeriodEnd);
    if (days === null) continue;

    let nextStage: number | null = null;
    let daysLabel = days;
    if (days <= 1 && u.trialWarningStage < 2) {
      nextStage = 2;
      daysLabel = 1;
    } else if (days <= 3 && u.trialWarningStage < 1) {
      nextStage = 1;
      daysLabel = 3;
    }
    if (nextStage === null) continue;

    try {
      await sendTrialEndingEmail(u.email, daysLabel);
    } catch (err) {
      log.error({ err, userId: u.id }, 'Failed to send trial-ending email');
      continue;
    }

    await db
      .update(users)
      .set({ trialWarningStage: nextStage })
      .where(and(eq(users.id, u.id), eq(users.trialWarningStage, u.trialWarningStage)));
    sent += 1;
  }
  return sent;
}
