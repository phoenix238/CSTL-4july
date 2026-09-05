import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, londonDateKey, londonTime, londonWeekdayIndex } from "@/lib/time";
import { loadAvailabilityWithTrace, defaultSlotWindow } from "./slots";
import { explainEmptyDay, resolveWeeklyHours, type DayTrace, type WeeklyWindow } from "./availability";
import { CLINIC_LABEL, type Clinic } from "./rules";

const CLINICS: Clinic[] = ["waterloo", "bethnal"];

export interface CapacityIssue {
  /** dedupe key stored in AppSettings.emptyDayAlerts */
  key: string;
  clinic: Clinic;
  dateKey: string;
  reason: string;
}

/** "YYYY-MM-DD" -> a real London midday instant (midday, so a clock change can't move the day). */
function dateKeyToDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return londonTime(y, m, d, 12, 0);
}

/**
 * Why an empty day is worth telling Phoenix about — or null when it isn't.
 *
 * Pure, so every branch of the "is this a problem or is this normal?" judgement
 * is unit-testable without a database, Google, or a clock. `hasOwnBookings` is
 * whether that clinic already holds confirmed sessions that day, and
 * `weekdayHasHours` whether the recurring weekly hours cover that weekday.
 *
 * What counts as a problem:
 * - A weekly cap's own accounting emptied it (the original Monday bug).
 * - The drawn window is too short to hold one session.
 * - A weekday that normally has hours has been left with no open time at all —
 *   i.e. a block override is cancelling a day that would otherwise be open.
 * - Busy time swallowed the whole day *and* nothing is booked into it. A full
 *   diary is success; a day eaten by calendar events with nothing to show for
 *   it is the "something ate my Monday" case.
 *
 * What doesn't:
 * - No hours set on a weekday that never has any — a deliberate closure.
 * - A day full of actual confirmed sessions.
 * - The minimum-notice window running out (happens on today, every run).
 * - The clocks changing — nothing to act on.
 */
export function emptyDayReason(
  day: DayTrace,
  { hasOwnBookings, weekdayHasHours }: { hasOwnBookings: boolean; weekdayHasHours: boolean },
): string | null {
  if (day.bookable > 0) return null;

  if (day.openMinutes === 0) {
    // Only a problem when this weekday normally opens — then something (a block
    // override) has closed a day that would otherwise have been bookable.
    return weekdayHasHours ? "Your usual hours for this day are fully blocked out" : null;
  }
  if (day.candidates === 0) return "The hours set are shorter than one session";
  if (day.dropped.cap > 0) return explainEmptyDay(day);
  if (day.dropped.hours > 0) return "The hours set don't leave room for a full session";
  if (day.dropped.busy > 0 && !hasOwnBookings) {
    return "Busy time on your calendar covers the whole day, with nothing booked into it";
  }
  return null;
}

/**
 * Which of today's issues are new (not already alerted), and what the
 * updated dedupe map should be. Split out from the sweep below so the
 * diffing logic — the actual "alert once, forget once healed" behaviour —
 * is unit-testable without a database or Gmail.
 */
export function diffCapacityAlerts(
  current: CapacityIssue[],
  prevAlerted: Record<string, string>,
  asOf: Date,
): { nextAlerted: Record<string, string>; newIssues: CapacityIssue[] } {
  const nextAlerted: Record<string, string> = {};
  for (const issue of current) {
    nextAlerted[issue.key] = prevAlerted[issue.key] ?? asOf.toISOString();
  }
  const newIssues = current.filter((i) => !(i.key in prevAlerted));
  return { nextAlerted, newIssues };
}

/**
 * Finds any day inside the public booking window that a client can't book into
 * when it looks like they should be able to — the "Monday looked available but
 * wasn't" failure mode — and emails Phoenix about it. `emptyDayReason` above
 * decides what counts.
 *
 * Emails once per (clinic, day) via `diffCapacityAlerts`'s dedupe map on
 * AppSettings.emptyDayAlerts — not on every run while it stays broken — and
 * forgets the key once that day is bookable again, so a later recurrence
 * re-alerts. Same shape as the calendar reconcile sweep's `calendarAlertAt`.
 */
export async function sweepCapacityAlerts({
  asOf = new Date(),
  dryRun = false,
}: { asOf?: Date; dryRun?: boolean } = {}): Promise<{ issues: CapacityIssue[]; newIssues: CapacityIssue[] }> {
  const { windowStart, windowEnd } = await defaultSlotWindow();
  const settings = await getSettings();
  const weeklyHours = resolveWeeklyHours(settings.weeklyHours);

  // Which (clinic, day) pairs already hold confirmed sessions — the difference
  // between "the diary is full" (fine) and "something ate this day" (not).
  const booked = new Set<string>();
  const confirmed = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: windowStart, lt: windowEnd } },
    select: { clinic: true, startsAt: true },
  });
  for (const b of confirmed) booked.add(`${b.clinic}:${londonDateKey(b.startsAt)}`);

  const issues: CapacityIssue[] = [];
  for (const clinic of CLINICS) {
    const windows: WeeklyWindow[] = weeklyHours[clinic];
    const { days } = await loadAvailabilityWithTrace({ clinic, windowStart, windowEnd });
    for (const day of days as DayTrace[]) {
      const key = `${clinic}:${day.dateKey}`;
      const weekday = londonWeekdayIndex(dateKeyToDate(day.dateKey));
      const reason = emptyDayReason(day, {
        hasOwnBookings: booked.has(key),
        weekdayHasHours: windows.some((w) => w.weekday === weekday),
      });
      if (reason) issues.push({ key, clinic, dateKey: day.dateKey, reason });
    }
  }

  const prevAlerted = (settings.emptyDayAlerts as Record<string, string> | null) ?? {};
  const { nextAlerted, newIssues } = diffCapacityAlerts(issues, prevAlerted, asOf);

  if (dryRun) return { issues, newIssues };

  await prisma.appSettings.update({ where: { id: 1 }, data: { emptyDayAlerts: nextAlerted } });

  if (newIssues.length) {
    const to = process.env.ALLOWED_EMAIL;
    if (to) {
      const lines = [
        `${newIssues.length} day${newIssues.length === 1 ? "" : "s"} in the booking window can't be booked when ${
          newIssues.length === 1 ? "it" : "they"
        } probably should:`,
        "",
        ...newIssues.map((i) => `  ${fmtDayLong(dateKeyToDate(i.dateKey))} · ${CLINIC_LABEL[i.clinic]}: ${i.reason}`),
        "",
        "Open the calendar on those days to see the same reason in place.",
        "This won't repeat once each day is bookable again.",
      ];
      try {
        await sendEmail(
          to,
          `${newIssues.length} booking day${newIssues.length === 1 ? "" : "s"} to check`,
          lines.join("\n"),
        );
      } catch (err) {
        console.error("Couldn't send the capacity alert email", err);
      }
    }
  }

  return { issues, newIssues };
}
