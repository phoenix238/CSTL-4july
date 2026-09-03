import { NextResponse } from "next/server";
import { syncBankPayments } from "@/lib/payments/sync";
import { sweepUnpaidSessions } from "@/lib/payments/unpaid";
import { reconcileUpcomingEvents } from "@/lib/google/reconcile";
import { runAvailabilitySync } from "@/lib/google/availabilitySync";
import { sweepSessionReminders } from "@/lib/reminders/sessionReminders";

/**
 * The daily heartbeat: pull new bank payments and match them, flag sessions
 * that are overdue for payment, and check upcoming bookings still have their
 * calendar event.
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
      const [unpaid, calendar, reminders] = await Promise.all([
        sweepUnpaidSessions({ asOf, dryRun: true }),
        reconcileUpcomingEvents({ asOf, dryRun: true }).catch((err) => {
          console.error("Dry-run reconcile failed", err);
          return { issues: [], newIssues: [] };
        }),
        sweepSessionReminders({ asOf, dryRun: true }).catch((err) => {
          console.error("Dry-run reminder sweep failed", err);
          return { due: [], sent: 0 };
        }),
      ]);
      return NextResponse.json({
        dryRun: true,
        asOf: asOf.toISOString(),
        unpaid: { overdue: unpaid.overdue, wouldNotify: unpaid.newlyFlagged },
        calendar: { issues: calendar.issues, wouldNotify: calendar.newIssues },
        reminders: { wouldSend: reminders.due },
      });
    }

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

    return NextResponse.json({
      ...sync,
      unpaidFlagged: unpaid.newlyFlagged.length,
      unpaidTotal: unpaid.overdue.length,
      calendarIssues: calendar.newIssues.length,
      availabilitySync: availability,
      remindersSent: reminders.sent,
    });
  } catch (err) {
    console.error("Scheduled sync failed", err);
    return NextResponse.json({ error: "Scheduled sync failed" }, { status: 500 });
  }
}
