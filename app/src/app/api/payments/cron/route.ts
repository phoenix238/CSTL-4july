import { NextResponse } from "next/server";
import { syncBankPayments } from "@/lib/payments/sync";
import { sweepUnpaidSessions } from "@/lib/payments/unpaid";
import { reconcileUpcomingEvents } from "@/lib/google/reconcile";

/**
 * The hourly heartbeat: pull new bank payments and match them, flag sessions
 * that are overdue for payment, and check upcoming bookings still have their
 * calendar event.
 *
 * Not behind the normal sign-in guard, because a scheduler has no session — so
 * it carries its own shared secret instead. Without CRON_SECRET set the route
 * refuses outright rather than falling open: an unauthenticated endpoint that
 * reads the bank feed is not something to leave running by accident.
 *
 * Vercel's scheduler sends `Authorization: Bearer <CRON_SECRET>`. It runs hourly
 * (see vercel.json) because the unpaid sweep works to a 25-hour boundary a daily
 * run can't resolve.
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
      const [unpaid, calendar] = await Promise.all([
        sweepUnpaidSessions({ asOf, dryRun: true }),
        reconcileUpcomingEvents({ asOf, dryRun: true }).catch((err) => {
          console.error("Dry-run reconcile failed", err);
          return { issues: [], newIssues: [] };
        }),
      ]);
      return NextResponse.json({
        dryRun: true,
        asOf: asOf.toISOString(),
        unpaid: { overdue: unpaid.overdue, wouldNotify: unpaid.newlyFlagged },
        calendar: { issues: calendar.issues, wouldNotify: calendar.newIssues },
      });
    }

    const sync = await syncBankPayments();
    const unpaid = await sweepUnpaidSessions({ asOf });
    // Calendar reconcile needs Google; never let it fail the whole run.
    const calendar = await reconcileUpcomingEvents({ asOf }).catch((err) => {
      console.error("Calendar reconcile failed", err);
      return { issues: [], newIssues: [] };
    });

    return NextResponse.json({
      ...sync,
      unpaidFlagged: unpaid.newlyFlagged.length,
      unpaidTotal: unpaid.overdue.length,
      calendarIssues: calendar.newIssues.length,
    });
  } catch (err) {
    console.error("Scheduled sync failed", err);
    return NextResponse.json({ error: "Scheduled sync failed" }, { status: 500 });
  }
}
