import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { getCalendarApi, calendarId } from "./client";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/** How far ahead to check that bookings still have a matching calendar event. */
export const RECONCILE_HORIZON_DAYS = 14;

export interface CalendarIssue {
  bookingId: string;
  clientName: string;
  whenLabel: string;
  clinic: Clinic;
  problem: "missing" | "moved";
  movedToLabel?: string;
}

function statusCode(err: unknown): number | undefined {
  const e = err as { code?: number; response?: { status?: number } };
  return e?.code ?? e?.response?.status;
}

/**
 * Check that each upcoming confirmed booking still has its calendar event, where
 * the booking says it is. If Phoenix deletes or drags an event in Google, the
 * app still thinks the client is coming — this catches that drift.
 *
 * Notifies him once per problem (calendarAlertAt), and clears the flag when an
 * event lines up again, so a fixed booking stops nagging. In dry-run nothing is
 * written or emailed; `asOf` is injectable for testing.
 */
export async function reconcileUpcomingEvents({
  asOf = new Date(),
  dryRun = false,
}: { asOf?: Date; dryRun?: boolean } = {}): Promise<{ issues: CalendarIssue[]; newIssues: CalendarIssue[] }> {
  const horizon = new Date(asOf.getTime() + RECONCILE_HORIZON_DAYS * 86_400_000);
  const bookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: asOf, lte: horizon }, personalEventId: { not: "" } },
    include: { client: { select: { name: true } } },
  });
  if (!bookings.length) return { issues: [], newIssues: [] };

  const calendar = await getCalendarApi();
  const calId = await calendarId("personal");

  const issues: CalendarIssue[] = [];
  const newlyIds: string[] = [];
  const healedIds: string[] = [];

  for (const b of bookings) {
    let problem: "missing" | "moved" | null = null;
    let movedToLabel: string | undefined;
    try {
      const ev = await calendar.events.get({ calendarId: calId, eventId: b.personalEventId });
      if (ev.data.status === "cancelled") {
        problem = "missing";
      } else if (ev.data.start?.dateTime) {
        const evStart = new Date(ev.data.start.dateTime);
        if (Math.abs(evStart.getTime() - b.startsAt.getTime()) > 60_000) {
          problem = "moved";
          movedToLabel = `${fmtDayLong(evStart)} · ${fmtTime(evStart)}`;
        }
      }
    } catch (err) {
      const code = statusCode(err);
      if (code === 404 || code === 410) {
        problem = "missing";
      } else {
        // Transient/unknown — don't alarm on a network blip; try again next run.
        console.error("reconcile: couldn't fetch event for booking", b.id, err);
        continue;
      }
    }

    if (problem) {
      issues.push({
        bookingId: b.id,
        clientName: b.client.name,
        whenLabel: `${fmtDayLong(b.startsAt)} · ${fmtTime(b.startsAt)}`,
        clinic: b.clinic as Clinic,
        problem,
        movedToLabel,
      });
      if (b.calendarAlertAt === null) newlyIds.push(b.id);
    } else if (b.calendarAlertAt !== null) {
      healedIds.push(b.id);
    }
  }

  const newIssues = issues.filter((i) => newlyIds.includes(i.bookingId));
  if (dryRun) return { issues, newIssues };

  if (healedIds.length) {
    await prisma.booking.updateMany({ where: { id: { in: healedIds } }, data: { calendarAlertAt: null } });
  }

  if (newIssues.length) {
    const to = process.env.ALLOWED_EMAIL;
    if (to) {
      const lines = [
        `${newIssues.length} upcoming session${newIssues.length === 1 ? "'s calendar event looks" : "s' calendar events look"} out of sync:`,
        "",
        ...newIssues.map(
          (i) =>
            `  ${i.clientName} — ${i.whenLabel} · ${CLINIC_LABEL[i.clinic]}: ${
              i.problem === "missing" ? "event missing from the calendar" : `moved to ${i.movedToLabel}`
            }`,
        ),
        "",
        "If you moved or deleted these in Google, the app still has the original booking — reschedule or cancel it in the app so both sides agree.",
      ];
      try {
        await sendEmail(
          to,
          `${newIssues.length} calendar event${newIssues.length === 1 ? "" : "s"} out of sync`,
          lines.join("\n"),
        );
      } catch (err) {
        console.error("Couldn't send the calendar reconcile notification", err);
      }
    }
    await prisma.booking.updateMany({
      where: { id: { in: newIssues.map((i) => i.bookingId) } },
      data: { calendarAlertAt: asOf },
    });
  }

  return { issues, newIssues };
}
