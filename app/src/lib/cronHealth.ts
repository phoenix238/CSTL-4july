import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";

const MAX_AGE_HOURS = 48;

/**
 * Has the daily cron's heartbeat gone stale? No heartbeat at all (a fresh
 * deploy, or the cron has literally never once succeeded) counts as stale too
 * — there's nothing safer to assume.
 */
export function isCronStale(lastRunAt: Date | null, now: Date, maxAgeHours = MAX_AGE_HOURS): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() > maxAgeHours * 3600_000;
}

/**
 * The dead-man's switch for the daily cron itself (`/api/payments/cron`).
 *
 * Every other alert in this app is emitted BY that cron — the capacity alert,
 * the calendar reconcile, the unpaid sweep. All of them go silent together if
 * the cron ever stops running. This is the one check that fires precisely
 * when the cron can't fire itself, which is why it has to live behind a
 * separate trigger: a scheduled GitHub Actions workflow
 * (.github/workflows/cron-healthcheck.yml) pinging `/api/cron/healthcheck`,
 * not another Vercel cron — Vercel's Hobby plan allows only one daily
 * schedule, and it's already spent on the cron this watches.
 *
 * Emails once when the heartbeat (`AppSettings.lastCronRunAt`, written by the
 * cron on every successful real run) goes stale, then stays quiet until it's
 * fresh again — the same "alert once, forget once healed" shape as every
 * other dedupe in this codebase, just with a single flag instead of a
 * per-row/per-day map, since there's only one thing being watched here.
 */
export async function checkCronHealth(now = new Date()): Promise<{ stale: boolean; alertSent: boolean }> {
  const settings = await getSettings();
  const stale = isCronStale(settings.lastCronRunAt, now);

  if (!stale) {
    if (settings.cronDeadAlertSentAt) {
      await prisma.appSettings.update({ where: { id: 1 }, data: { cronDeadAlertSentAt: null } });
    }
    return { stale: false, alertSent: false };
  }

  if (settings.cronDeadAlertSentAt) return { stale: true, alertSent: false }; // already told him this outage

  const to = process.env.ALLOWED_EMAIL;
  if (to) {
    const lastRun = settings.lastCronRunAt ? settings.lastCronRunAt.toISOString() : "never (no heartbeat recorded)";
    try {
      await sendEmail(
        to,
        "The daily booking check hasn't run in over 48 hours",
        [
          "The automated daily check hasn't completed in over 48 hours.",
          `Last successful run: ${lastRun}`,
          "",
          "That check is also what sends the bank-payment sync, unpaid-session sweep, calendar reconcile, session reminders, and the empty-day capacity alert — all of those are silent right now too, not just this one.",
          "Worth checking Vercel's cron logs for /api/payments/cron.",
        ].join("\n"),
      );
    } catch (err) {
      console.error("Couldn't send the cron dead-man's-switch email", err);
    }
  }

  await prisma.appSettings.update({ where: { id: 1 }, data: { cronDeadAlertSentAt: now } });
  return { stale: true, alertSent: true };
}
