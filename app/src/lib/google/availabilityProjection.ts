// The pure core of the availability ⇄ Google Calendar sync: turning the app's
// bookable hours into the set of dated windows the calendar should hold, and
// reading a Google event's title/geometry back. No Prisma, no googleapis — so
// it's unit-tested directly (see availabilitySync.test.ts), the same way the
// booking engine in lib/booking/availability.ts is.

import { dayOpenIntervals, type OverrideWindow, type WeeklyHours } from "@/lib/booking/availability";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { londonAddDays, londonDateKey, londonMinutes, londonTime, londonWeekdayIndex } from "@/lib/time";

/** How far ahead the availability calendar is materialised. ~12 weeks — long
 *  enough for life-planning, bounded so the projection stays a few hundred
 *  events at most. The window rolls forward from today on each sync. */
export const AVAIL_HORIZON_DAYS = 84;

export const AVAIL_CLINICS: Clinic[] = ["waterloo", "bethnal"];

/** The canonical title the app writes for a block, per clinic. */
export function canonicalSummary(clinic: Clinic): string {
  return `Available — ${CLINIC_LABEL[clinic]}`;
}

/**
 * Which clinic a block created in Google belongs to. One shared calendar can't
 * tell the two apart, so we read a keyword from the title and fall back to the
 * configured default clinic when there isn't one.
 */
export function clinicFromTitle(title: string | null | undefined, fallback: Clinic): Clinic {
  const t = (title ?? "").toLowerCase();
  if (/bethnal|chalk|\bbg\b/.test(t)) return "bethnal";
  if (/waterloo|\bwloo\b/.test(t)) return "waterloo";
  return fallback;
}

export interface ExpectedWindow {
  clinic: Clinic;
  dateKey: string;
  startMin: number;
  endMin: number;
}

/** Stable identity of a window — clinic + day + minute span. */
export const keyOf = (w: { clinic: string; dateKey: string; startMin: number; endMin: number }) =>
  `${w.clinic}|${w.dateKey}|${w.startMin}|${w.endMin}`;

/**
 * The full set of open availability windows across a date range, per clinic —
 * exactly what `dayOpenIntervals` produces (weekly hours + open overrides minus
 * blocks), one entry per merged interval per London day.
 */
export function expectedWindows(args: {
  weeklyHours: WeeklyHours;
  overridesByClinic: Record<Clinic, OverrideWindow[]>;
  windowStart: Date;
  windowEnd: Date;
}): ExpectedWindow[] {
  const { weeklyHours, overridesByClinic, windowStart, windowEnd } = args;
  const out: ExpectedWindow[] = [];
  for (let day = new Date(windowStart); day < windowEnd; day = londonAddDays(day, 1)) {
    const dateKey = londonDateKey(day);
    const weekday = londonWeekdayIndex(day);
    for (const clinic of AVAIL_CLINICS) {
      const intervals = dayOpenIntervals(weekday, dateKey, weeklyHours[clinic], overridesByClinic[clinic]);
      for (const iv of intervals) out.push({ clinic, dateKey, startMin: iv.start, endMin: iv.end });
    }
  }
  return out;
}

/** Real UTC instants for a minute-of-day window on a London calendar date (DST-safe). */
export function windowInstants(dateKey: string, startMin: number, endMin: number): { start: Date; end: Date } {
  const [y, m, d] = dateKey.split("-").map(Number);
  return {
    start: londonTime(y, m, d, Math.floor(startMin / 60), startMin % 60),
    end: londonTime(y, m, d, Math.floor(endMin / 60), endMin % 60),
  };
}

/** Mon-first weekday index of a "YYYY-MM-DD" date (midday, so a clock change can't move it). */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return londonWeekdayIndex(londonTime(y, m, d, 12, 0));
}

/** The London day/window a Google event occupies, or null if it can't be used. */
export function geometryOf(
  startISO: string | null | undefined,
  endISO: string | null | undefined,
): { dateKey: string; startMin: number; endMin: number } | null {
  if (!startISO || !endISO) return null; // all-day (date-only) or malformed — ignored
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const dateKey = londonDateKey(start);
  const startMin = londonMinutes(start);
  // An event that ends past its start day (incl. exactly at the next midnight)
  // is clamped to end-of-day — availability blocks live within a single day.
  const endMin = londonDateKey(end) !== dateKey ? 1440 : londonMinutes(end);
  if (endMin <= startMin) return null;
  return { dateKey, startMin, endMin };
}
