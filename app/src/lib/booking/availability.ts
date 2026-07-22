// Turns Phoenix's recurring weekly hours + one-off date overrides + real
// Google Calendar busy time into actual bookable slot instants. Pure — no
// Prisma/Google imports — callers (the settings resolver, the public API
// routes) fetch the raw data and pass it in.

import { blockedRange, SESSION_MINUTES, type Clinic } from "./rules";
import { londonDateKey, londonMinutes, londonTime, londonWeekdayIndex, londonYMD } from "@/lib/time";

export interface WeeklyWindow {
  weekday: number; // 0=Mon..6=Sun, matches londonWeekdayIndex
  startMin: number; // minutes after London midnight
  endMin: number;
}

export interface WeeklyHours {
  waterloo: WeeklyWindow[];
  bethnal: WeeklyWindow[];
}

export const EMPTY_WEEKLY_HOURS: WeeklyHours = { waterloo: [], bethnal: [] };

function resolveWindows(raw: unknown): WeeklyWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: WeeklyWindow[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const item = w as Record<string, unknown>;
    const weekday = Number(item.weekday);
    const startMin = Number(item.startMin);
    const endMin = Number(item.endMin);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue;
    if (startMin < 0 || endMin > 1440 || startMin >= endMin) continue;
    out.push({ weekday, startMin, endMin });
  }
  return out;
}

/** Validate/normalise whatever is stored in AppSettings.weeklyHours. */
export function resolveWeeklyHours(raw: unknown): WeeklyHours {
  if (!raw || typeof raw !== "object") return EMPTY_WEEKLY_HOURS;
  const obj = raw as Record<string, unknown>;
  return {
    waterloo: resolveWindows(obj.waterloo),
    bethnal: resolveWindows(obj.bethnal),
  };
}

export interface OverrideWindow {
  date: string; // "YYYY-MM-DD"
  kind: "open" | "block";
  startMin: number;
  endMin: number;
}

export interface Interval {
  start: number;
  end: number;
}

/** Sort and merge overlapping/adjacent intervals. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** Remove `cut` from every interval in `base`, splitting as needed. */
export function subtractInterval(base: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const iv of base) {
    if (cut.end <= iv.start || cut.start >= iv.end) {
      out.push(iv);
      continue;
    }
    if (cut.start > iv.start) out.push({ start: iv.start, end: Math.min(cut.start, iv.end) });
    if (cut.end < iv.end) out.push({ start: Math.max(cut.end, iv.start), end: iv.end });
  }
  return out;
}

/** The open minute-of-day intervals for one clinic on one London calendar date. */
export function dayOpenIntervals(
  weekday: number,
  dateKey: string,
  weeklyHours: WeeklyWindow[],
  overrides: OverrideWindow[],
): Interval[] {
  let intervals = mergeIntervals(
    weeklyHours.filter((w) => w.weekday === weekday).map((w) => ({ start: w.startMin, end: w.endMin })),
  );
  const forDate = overrides.filter((o) => o.date === dateKey);
  const opens = forDate.filter((o) => o.kind === "open").map((o) => ({ start: o.startMin, end: o.endMin }));
  if (opens.length) intervals = mergeIntervals([...intervals, ...opens]);
  for (const block of forDate.filter((o) => o.kind === "block")) {
    intervals = subtractInterval(intervals, { start: block.startMin, end: block.endMin });
  }
  return intervals;
}

export interface AvailabilityParams {
  clinic: Clinic;
  windowStart: Date; // London-day-aligned (londonDayStart)
  windowEnd: Date;
  weeklyHours: WeeklyWindow[]; // this clinic's list only
  overrides: OverrideWindow[]; // this clinic's overrides only
  /**
   * Optional per-span `bufferMinutes` overrides the default `bufferMinutes`
   * for that one busy span — e.g. a studio-mate's booking on the shared
   * Chalk Farm calendar needs a bigger safety gap than Phoenix's own
   * back-to-back sessions do.
   */
  busy: Array<{ start: Date; end: Date; bufferMinutes?: number }>;
  slotMinutes?: number;
  bufferMinutes?: number;
  now?: Date;
  minNoticeMinutes?: number;
}

const pad = (iv: { start: Date; end: Date }, minutes: number) =>
  minutes > 0
    ? { start: new Date(iv.start.getTime() - minutes * 60_000), end: new Date(iv.end.getTime() + minutes * 60_000) }
    : iv;

/**
 * Does this exact candidate instant (at `minute` past London midnight) fit
 * inside one of the day's open intervals, with its full padded footprint,
 * and clear of every busy span? Shared by the grid scan below and by
 * `isSlotAvailable`, which checks one arbitrary instant that may not land on
 * the grid at all.
 */
function slotFits(
  candidate: Date,
  minute: number,
  intervals: Interval[],
  clinic: Clinic,
  busy: AvailabilityParams["busy"],
  bufferMinutes: number,
): boolean {
  // Both clinics currently footprint to exactly the session hour (see
  // blockedRange in rules.ts), but this stays generic in case a future
  // clinic rule pads its real calendar footprint beyond the raw session
  // minute — the whole padded footprint must fit inside the open interval.
  const rawFootprint = blockedRange(clinic, candidate);
  const startPadMin = Math.round((candidate.getTime() - rawFootprint.start.getTime()) / 60_000);
  const endPadMin = Math.round(
    (rawFootprint.end.getTime() - (candidate.getTime() + SESSION_MINUTES * 60_000)) / 60_000,
  );
  const footprintStart = minute - startPadMin - bufferMinutes;
  const footprintEnd = minute + SESSION_MINUTES + endPadMin + bufferMinutes;
  if (!intervals.some((iv) => footprintStart >= iv.start && footprintEnd <= iv.end)) return false;

  // Each busy span pads by its own buffer if it has one (e.g. a bigger
  // safety gap around a studio-mate's Chalk Farm booking), else the
  // default bufferMinutes — see the AvailabilityParams.busy doc comment.
  return !busy.some((b) => {
    const padded = pad(b, b.bufferMinutes ?? bufferMinutes);
    return rawFootprint.start < padded.end && rawFootprint.end > padded.start;
  });
}

/** Real bookable slot start times: open hours minus busy time, minus past/too-soon. */
export function computeAvailableSlots(params: AvailabilityParams): Date[] {
  const {
    clinic,
    windowStart,
    windowEnd,
    weeklyHours,
    overrides,
    busy,
    slotMinutes = 30,
    bufferMinutes = 0,
    now = new Date(),
    minNoticeMinutes = 0,
  } = params;
  const cutoff = new Date(now.getTime() + minNoticeMinutes * 60_000);
  const results: Date[] = [];

  for (let day = new Date(windowStart); day < windowEnd; day = new Date(day.getTime() + 86_400_000)) {
    const { y, m, d } = londonYMD(day);
    const weekday = londonWeekdayIndex(day);
    const dateKey = londonDateKey(day);
    const intervals = dayOpenIntervals(weekday, dateKey, weeklyHours, overrides);
    if (!intervals.length) continue;

    for (const interval of intervals) {
      for (let minute = interval.start; minute + SESSION_MINUTES <= interval.end; minute += slotMinutes) {
        const candidate = londonTime(y, m, d, Math.floor(minute / 60), minute % 60);
        if (candidate < cutoff) continue;
        if (!slotFits(candidate, minute, intervals, clinic, busy, bufferMinutes)) continue;
        results.push(candidate);
      }
    }
  }

  return results;
}

/**
 * Is this one exact instant still genuinely bookable, right now? Same rules
 * as `computeAvailableSlots`, but for a specific candidate rather than the
 * `slotMinutes`-stepped grid — a time offered from the admin calendar's
 * finer 15-min steps may fall between grid points and would otherwise never
 * appear as a "candidate" even though it's perfectly free.
 */
export function isSlotAvailable(
  candidate: Date,
  params: Omit<AvailabilityParams, "windowStart" | "windowEnd" | "slotMinutes">,
): boolean {
  const { clinic, weeklyHours, overrides, busy, bufferMinutes = 0, now = new Date(), minNoticeMinutes = 0 } = params;
  const cutoff = new Date(now.getTime() + minNoticeMinutes * 60_000);
  if (candidate < cutoff) return false;

  const weekday = londonWeekdayIndex(candidate);
  const dateKey = londonDateKey(candidate);
  const intervals = dayOpenIntervals(weekday, dateKey, weeklyHours, overrides);
  if (!intervals.length) return false;

  const minute = londonMinutes(candidate);
  return slotFits(candidate, minute, intervals, clinic, busy, bufferMinutes);
}
