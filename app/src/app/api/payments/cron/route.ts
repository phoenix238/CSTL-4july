import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncBankPayments } from "@/lib/payments/sync";
import { sweepUnpaidSessions } from "@/lib/payments/unpaid";
import { reconcileUpcomingEvents } from "@/lib/google/reconcile";
import { runAvailabilitySync } from "@/lib/google/availabilitySync";
import { sweepSessionReminders } from "@/lib/reminders/sessionReminders";
import { sweepCapacityAlerts } from "@/lib/booking/capacityAlerts";

/**
 * The daily heartbeat: pull new bank payments and match them, flag sessions
 * that are overdue for payment, check upcoming bookings still have their
 * calendar event, and check no day in the public booking window has quietly
 * gone empty despite hours being set.
 *
 * Not behind the normal sign-in guard, because a scheduler has no session — so
 * it carries its own shared secret instead. Without CRON_SECRET set the route
 * refuses outright rather than falling open: an unauthenticated endpoint that
 * reads the bank feed is not something to leave running by accident.
 *
 * Vercel's scheduler sends `Authorization: Bearer <CRON_SECRET>`. It runs once a
 * day (see vercel.json) — the Hobby plan doesn't allow more often. The unpaid
 * sweep's 25-hour boundary still resolves correctly at this cadence (each
 * booking is flagged once via unpaidNotifiedAt regardless of how often the sweep
 * runs); it just means a session can sit unflagged for up to ~24h longer than an
 * hourly sweep would allow, since the run only happens once a day.
 *
 * Every real run writes AppSettings.lastCronRunAt as its last step — a
 * heartbeat watched independently by /api/cron/healthcheck (see
 * cronHealth.ts), since this route can't detect its own failure to run at all.
 *
 * `?dryRun=1&asOf=<ISO>` reports what the unpaid sweep and calendar reconcile
 * *would* do at that moment, without emailing, flagging, or touching payments —
 * so the 25-hour rule is testable without waiting 25 hours. Still behind the
 * secret.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const asOfParam = url.searchParams.get("asOf");
  const asOf = asOfParam ? new Date(asOfParam) : new Date();
  if (asOfParam && Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: "Invalid asOf — use an ISO date" }, { status: 400 });
  }

  try {
    if (dryRun) {
      const [unpaid, calendar, reminders, capacity] = await Promise.all([
        sweepUnpaidSessions({ asOf, dryRun: true }),
        reconcileUpcomingEvents({ asOf, dryRun: true }).catch((err) => {
          console.error("Dry-run reconcile failed", err);
          return { issues: [], newIssues: [] };
        }),
        sweepSessionReminders({ asOf, dryRun: true }).catch((err) => {
          console.error("Dry-run reminder sweep failed", err);
          return { due: [], sent: 0 };
        }),
        sweepCapacityAlerts({ asOf, dryRun: true }).catch((err) => {
          console.error("Dry-run capacity sweep failed", err);
          return { issues: [], newIssues: [] };
        }),
      ]);
      return NextResponse.json({
        dryRun: true,
        asOf: asOf.toISOString(),
        unpaid: { overdue: unpaid.overdue, wouldNotify: unpaid.newlyFlagged },
        calendar: { issues: calendar.issues, wouldNotify: calendar.newIssues },
        reminders: { wouldSend: reminders.due },
        capacity: { issues: capacity.issues, wouldNotify: capacity.newIssues },
      });
    }

    // First, and guarded: this is the safety net that tells Phoenix a day has
    // quietly stopped being bookable. syncBankPayments/sweepUnpaidSessions below
    // are deliberately unguarded (a bank failure should surface as a 500), so
    // anything running after them is skipped entirely on a Starling outage —
    // which is exactly when a silent monitor must not also go silent.
    const capacity = await sweepCapacityAlerts({ asOf }).catch((err) => {
      console.error("Capacity alert sweep failed", err);
      return { issues: [], newIssues: [] };
    });

    const sync = await syncBankPayments();
    const unpaid = await sweepUnpaidSessions({ asOf });
    // Calendar reconcile needs Google; never let it fail the whole run.
    const calendar = await reconcileUpcomingEvents({ asOf }).catch((err) => {
      console.error("Calendar reconcile failed", err);
      return { issues: [], newIssues: [] };
    });
    // Availability ⇄ Google two-way sync (the daily "periodic" catch-up in
    // addition to the on-open pull). Needs Google; never fail the run over it.
    const availability = await runAvailabilitySync().catch((err) => {
      console.error("Availability sync failed", err);
      return { connected: false as const };
    });
    // The clients' own session reminders, at the lead times they picked. Needs
    // Google (Gmail); never fail the run over it.
    const reminders = await sweepSessionReminders({ asOf }).catch((err) => {
      console.error("Session reminder sweep failed", err);
      return { due: [], sent: 0 };
    });

    // The dead-man's-switch heartbeat (see cronHealth.ts) — written last, only
    // once the run has genuinely completed. Every step above already swallows
    // its own failure, so reaching here means the run went end-to-end even if
    // Google or the bank feed had a bad day; syncBankPayments/sweepUnpaidSessions
    // above are the two steps that don't, so a real failure there skips this
    // and leaves the heartbeat stale, which is the correct outcome. Real wall-
    // clock time, deliberately not `asOf` — a manually-triggered run with a
    // backdated `?asOf=` must never make the heartbeat itself look stale.
    await prisma.appSettings.update({ where: { id: 1 }, data: { lastCronRunAt: new Date() } });

    return NextResponse.json({
      ...sync,
      unpaidFlagged: unpaid.newlyFlagged.length,
      unpaidTotal: unpaid.overdue.length,
      calendarIssues: calendar.newIssues.length,
      availabilitySync: availability,
      remindersSent: reminders.sent,
      capacityIssues: capacity.newIssues.length,
    });
  } catch (err) {
    console.error("Scheduled sync failed", err);
    return NextResponse.json({ error: "Scheduled sync failed" }, { status: 500 });
  }
}
