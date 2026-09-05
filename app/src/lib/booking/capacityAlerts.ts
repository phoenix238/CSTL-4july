import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, londonTime } from "@/lib/time";
import { loadAvailabilityWithTrace, defaultSlotWindow } from "./slots";
import { explainEmptyDay, type DayTrace } from "./availability";
import { CLINIC_LABEL, type Clinic } from "./rules";

const CLINICS: Clinic[] = ["waterloo", "bethnal"];

export interface CapacityIssue {
  /** dedupe key stored in AppSettings.emptyDayAlerts */
  key: string;
  clinic: Clinic;
  dateKey: string;
  reason: string;
}

/** "YYYY-MM-DD" -> a real London midday instant, for formatting only. */
function dateKeyToDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return londonTime(y, m, d, 12, 0);
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
 * Finds any day inside the public booking window that hours/overrides were
 * drawn on but that a *setting* has quietly emptied — the "Monday looked
 * available but wasn't" failure mode. Deliberately narrow about what counts:
 *
 * - No hours set at all → a deliberate closure, not a problem.
 * - Everything's taken (`busy`) → a genuinely full diary. That's success, not
 *   a bug, and alerting on it would mean an email most days once the diary
 *   fills up.
 * - Too soon to book (`past`) → the minimum-notice window running out as a day
 *   ends is expected and happens to some degree on `windowStart`(today) every
 *   single run; it isn't a configuration mistake.
 * - The clocks changing (`clockChange`) → nothing to fix.
 *
 * That leaves `cap` (a weekly cap's own accounting reached, as in the Monday
 * bug this replaces) and `hours` (the drawn window is too short for one
 * session) — both are settings math producing an empty day nobody intended.
 *
 * Emails Phoenix once per (clinic, day) via `diffCapacityAlerts`'s dedupe map
 * on AppSettings.emptyDayAlerts — not on every run while it stays broken —
 * and naturally stops mentioning it once that day is bookable again, the same
 * shape as the calendar reconcile sweep's `calendarAlertAt` (see reconcile.ts).
 */
export async function sweepCapacityAlerts({
  asOf = new Date(),
  dryRun = false,
}: { asOf?: Date; dryRun?: boolean } = {}): Promise<{ issues: CapacityIssue[]; newIssues: CapacityIssue[] }> {
  const { windowStart, windowEnd } = await defaultSlotWindow();

  const issues: CapacityIssue[] = [];
  for (const clinic of CLINICS) {
    const { days } = await loadAvailabilityWithTrace({ clinic, windowStart, windowEnd });
    for (const day of days as DayTrace[]) {
      if (day.bookable > 0) continue;
      // "Shorter than one session" (openMinutes > 0, no candidates at all) and
      // a footprint that doesn't fit its window (dropped.hours) are the same
      // "hours don't leave room" family explainEmptyDay reports — both are
      // config, like the cap. See the filter's rationale in the docstring above.
      const tooShort = day.openMinutes > 0 && day.candidates === 0;
      if (!tooShort && day.dropped.cap === 0 && day.dropped.hours === 0) continue;
      issues.push({ key: `${clinic}:${day.dateKey}`, clinic, dateKey: day.dateKey, reason: explainEmptyDay(day) });
    }
  }

  const settings = await getSettings();
  const prevAlerted = (settings.emptyDayAlerts as Record<string, string> | null) ?? {};
  const { nextAlerted, newIssues } = diffCapacityAlerts(issues, prevAlerted, asOf);

  if (dryRun) return { issues, newIssues };

  await prisma.appSettings.update({ where: { id: 1 }, data: { emptyDayAlerts: nextAlerted } });

  if (newIssues.length) {
    const to = process.env.ALLOWED_EMAIL;
    if (to) {
      const lines = [
        `${newIssues.length} day${newIssues.length === 1 ? "" : "s"} in the booking window ${
          newIssues.length === 1 ? "looks" : "look"
        } empty even though hours are set:`,
        "",
        ...newIssues.map((i) => `  ${fmtDayLong(dateKeyToDate(i.dateKey))} · ${CLINIC_LABEL[i.clinic]}: ${i.reason}`),
        "",
        "Check the calendar to see why — this won't repeat once each day is bookable again.",
      ];
      try {
        await sendEmail(
          to,
          `${newIssues.length} empty booking day${newIssues.length === 1 ? "" : "s"} to check`,
          lines.join("\n"),
        );
      } catch (err) {
        console.error("Couldn't send the capacity alert email", err);
      }
    }
  }

  return { issues, newIssues };
}
