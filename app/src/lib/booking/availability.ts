// Turns Phoenix's recurring weekly hours + one-off date overrides + real
// Google Calendar busy time into actual bookable slot instants. Pure — no
// Prisma/Google imports — callers (the settings resolver, the public API
// routes) fetch the raw data and pass it in.

import { blockedRange, SESSION_MINUTES, type Clinic } from "./rules";
import {
  londonAddDays,
  londonDateKey,
  londonMinutes,
  londonTime,
  londonTimeExact,
  londonWeekdayIndex,
  londonWeekStart,
  londonYMD,
} from "@/lib/time";

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
  /**
   * "YYYY-MM-DD". For a one-off, the date it applies to. For a repeating
   * window, the date it was drawn on — the first day it applies, and the
   * weekday it recurs on thereafter.
   */
  date: string;
  kind: "open" | "block";
  startMin: number;
  endMin: number;
  /** applies to `date`'s weekday every week from `date` onward, until removed */
  repeatWeekly?: boolean;
  /**
   * An "open" window that offers only its start time, as a single pickable slot,
   * instead of a grid of starts across it. So a day can be built from specific
   * times ("7:00, 8:15") rather than an open block. Ignored for a "block".
   */
  exactStart?: boolean;
}

/**
 * Does this override apply to the given London day?
 *
 * A one-off matches its own date. A repeating one matches the same weekday on
 * that date or any later one — string comparison is safe and exact on
 * "YYYY-MM-DD", and avoids inventing instants for a purely calendar question.
 */
export function overrideAppliesOn(
  o: { date: string; repeatWeekly?: boolean },
  dateKey: string,
  weekday: number,
): boolean {
  if (o.date === dateKey) return true;
  if (!o.repeatWeekly) return false;
  return o.date < dateKey && overrideWeekday(o.date) === weekday;
}

/** Mon-first weekday index of a "YYYY-MM-DD" date. */
function overrideWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // Midday, so the answer can't be moved by a clock change.
  return londonWeekdayIndex(londonTime(y, m, d, 12, 0));
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

/**
 * The open minute-of-day intervals for one clinic on one London calendar date.
 *
 * `gridOnly` leaves out exact-start open windows — the ones offering a single
 * pickable time rather than a grid of starts. The slot scan asks for the grid
 * set (to step across) and the full set (to check a candidate's footprint fits
 * in open time) separately; an exact slot must count as open time without
 * spawning a grid of extra starts inside its own window.
 */
export function dayOpenIntervals(
  weekday: number,
  dateKey: string,
  weeklyHours: WeeklyWindow[],
  overrides: OverrideWindow[],
  { gridOnly = false }: { gridOnly?: boolean } = {},
): Interval[] {
  let intervals = mergeIntervals(
    weeklyHours.filter((w) => w.weekday === weekday).map((w) => ({ start: w.startMin, end: w.endMin })),
  );
  const forDate = overrides.filter((o) => overrideAppliesOn(o, dateKey, weekday));
  const opens = forDate
    .filter((o) => o.kind === "open" && !(gridOnly && o.exactStart))
    .map((o) => ({ start: o.startMin, end: o.endMin }));
  if (opens.length) intervals = mergeIntervals([...intervals, ...opens]);
  for (const block of forDate.filter((o) => o.kind === "block")) {
    intervals = subtractInterval(intervals, { start: block.startMin, end: block.endMin });
  }
  return intervals;
}

/** The exact-start times an "open" override contributes on one day (as minutes). */
export function exactStartsOn(overrides: OverrideWindow[], dateKey: string, weekday: number): number[] {
  return overrides
    .filter((o) => o.kind === "open" && o.exactStart && overrideAppliesOn(o, dateKey, weekday))
    .map((o) => o.startMin);
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
  /**
   * A cap on Bethnal Green's shared Chalk Farm *room time* per London calendar
   * week (Mon-Sun) — the real hours held with the studio, not a count of
   * sessions.
   *
   * Each day's room block runs from `edgeBufferMinutes` before the first
   * session to the same after the last (gaps between sessions included — that
   * time is still the room booked). A candidate is rejected if the extra block
   * time it would add to its day pushes the week's total past `capMinutes`.
   *
   * `blockMinutesByWeek` (keyed by `londonDateKey(londonWeekStart(...))`) is the
   * current total, and `sessionMinsByDay` (minute-of-day starts, keyed by
   * `londonDateKey`) lets the marginal cost of adding one session be computed.
   * Both already exclude the booking being rescheduled, if any.
   */
  weeklyCap?: {
    capMinutes: number;
    edgeBufferMinutes: number;
    blockMinutesByWeek: Record<string, number>;
    sessionMinsByDay: Record<string, number[]>;
  };
}

/**
 * Minutes of shared Chalk Farm room held on one day for a set of session start
 * times (as minutes past London midnight): from `edgeBufferMinutes` before the
 * earliest session to the same after the latest session's end. Empty → 0. Pure,
 * so the cap math is unit-testable and matches the real block in chalkFarm.ts.
 */
export function chalkFarmDayBlockMinutes(sessionStartMins: number[], edgeBufferMinutes: number): number {
  if (!sessionStartMins.length) return 0;
  const first = Math.min(...sessionStartMins);
  const last = Math.max(...sessionStartMins);
  return last + SESSION_MINUTES + edgeBufferMinutes - (first - edgeBufferMinutes);
}

const pad = (iv: { start: Date; end: Date }, minutes: number) =>
  minutes > 0
    ? { start: new Date(iv.start.getTime() - minutes * 60_000), end: new Date(iv.end.getTime() + minutes * 60_000) }
    : iv;

/**
 * Why a candidate didn't make it — "ok" when it did.
 *
 * Reported rather than swallowed so the admin calendar can say *why* a day has
 * nothing on it. Every explanation shown there comes from this one pass, so the
 * reason a slot is missing is always the real reason.
 */
export type FitResult = "ok" | "hours" | "busy" | "cap";

/**
 * Does this exact candidate instant (at `minute` past London midnight) fit
 * inside one of the day's open intervals, and clear of every busy span?
 * Shared by the grid scan below and by `isSlotAvailable`, which checks one
 * arbitrary instant that may not land on the grid at all.
 */
function slotFits(
  candidate: Date,
  minute: number,
  intervals: Interval[],
  clinic: Clinic,
  busy: AvailabilityParams["busy"],
  bufferMinutes: number,
  weeklyCap?: AvailabilityParams["weeklyCap"],
): FitResult {
  // Both clinics currently footprint to exactly the session hour (see
  // blockedRange in rules.ts), but this stays generic in case a future
  // clinic rule pads its real calendar footprint beyond the raw session
  // minute — that real footprint must fit inside the open interval.
  //
  // `bufferMinutes` is deliberately NOT part of this check: it's breathing
  // room between sessions, not a reason to shrink the working day. Counting
  // it here would make the first and last slot of every window unbookable,
  // and would wipe out any window shorter than a session plus two buffers
  // (e.g. a 1-hour evening segment) entirely.
  const rawFootprint = blockedRange(clinic, candidate);
  const startPadMin = Math.round((candidate.getTime() - rawFootprint.start.getTime()) / 60_000);
  const endPadMin = Math.round(
    (rawFootprint.end.getTime() - (candidate.getTime() + SESSION_MINUTES * 60_000)) / 60_000,
  );
  // Deliberately NOT padded by `bufferMinutes`. The buffer is breathing room
  // between Phoenix and *other bookings* — it is not clearance he needs from the
  // edge of his own working day. Padding it here cost an hour a day: hours of
  // 09:00–17:00 with a 15-min buffer offered nothing before 09:30 or after 15:30.
  const footprintStart = minute - startPadMin;
  const footprintEnd = minute + SESSION_MINUTES + endPadMin;
  const openInterval = intervals.find((iv) => footprintStart >= iv.start && footprintEnd <= iv.end);
  if (!openInterval) return "hours";

  // The open interval this candidate sits in, as real instants — used to decide
  // whether the default client gap even applies to a given busy span.
  const intervalStart = new Date(candidate.getTime() - (minute - openInterval.start) * 60_000);
  const intervalEnd = new Date(candidate.getTime() + (openInterval.end - minute) * 60_000);

  // Each busy span pads by its own buffer if it has one (a bigger safety gap
  // around a studio-mate's Chalk Farm booking, or the travel time to the other
  // clinic), else the default bufferMinutes — see AvailabilityParams.busy.
  const busyClash = busy.some((b) => {
    // A span with its own buffer carries a *physical* constraint — a room
    // that's taken, a journey that has to be made — so its clearance always
    // applies, wherever the span sits.
    //
    // The default client gap is different: it's breathing room *within* a
    // stretch of open time. When two windows are separated by a gap Phoenix
    // drew on purpose (say 19:00–20:00 then 20:15–21:15), that 15 minutes is
    // already his considered answer, and letting the slider add more would
    // silently delete the second session the moment the first was booked. So
    // the default gap only applies between sessions inside the *same* window.
    const sameWindow = b.start < intervalEnd && b.end > intervalStart;
    const gap = b.bufferMinutes ?? (sameWindow ? bufferMinutes : 0);
    const padded = pad(b, gap);
    return rawFootprint.start < padded.end && rawFootprint.end > padded.start;
  });
  if (busyClash) return "busy";

  if (weeklyCap) {
    // The cap counts room-block time, so a session's cost is how much it would
    // *extend* its day's block — nothing if it slots between two existing
    // sessions, a full hour-plus-padding if it opens a new day.
    const dateKey = londonDateKey(candidate);
    const weekKey = londonDateKey(londonWeekStart(candidate));
    const dayStarts = weeklyCap.sessionMinsByDay[dateKey] ?? [];
    const edge = weeklyCap.edgeBufferMinutes;
    const delta =
      chalkFarmDayBlockMinutes([...dayStarts, minute], edge) - chalkFarmDayBlockMinutes(dayStarts, edge);
    const weekTotal = weeklyCap.blockMinutesByWeek[weekKey] ?? 0;
    if (weekTotal + delta > weeklyCap.capMinutes) return "cap";
  }

  return "ok";
}

/** What happened on one London day, so an empty one can explain itself. */
export interface DayTrace {
  dateKey: string;
  /** total open minutes from weekly hours + overrides, before anything else applies */
  openMinutes: number;
  /** grid positions considered inside those hours */
  candidates: number;
  bookable: number;
  /** why the rest were dropped */
  dropped: { past: number; hours: number; busy: number; cap: number; clockChange: number };
}

/**
 * The slots, and a per-day account of how they were arrived at.
 *
 * `computeAvailableSlots` is this function without the trace. They are the same
 * pass on purpose: the admin calendar's explanation of an empty day has to come
 * from the code that actually decides, or it becomes another thing that can
 * disagree with the booking page — which is the bug it exists to prevent.
 */
export function computeAvailability(params: AvailabilityParams): { slots: Date[]; days: DayTrace[] } {
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
    weeklyCap,
  } = params;
  const cutoff = new Date(now.getTime() + minNoticeMinutes * 60_000);
  const results: Date[] = [];
  const days: DayTrace[] = [];

  // Step by London calendar days (DST-safe). A fixed 24 h step would process
  // the autumn fall-back Sunday twice (duplicate slots) and drop a day.
  for (let day = new Date(windowStart); day < windowEnd; day = londonAddDays(day, 1)) {
    const { y, m, d } = londonYMD(day);
    const weekday = londonWeekdayIndex(day);
    const dateKey = londonDateKey(day);
    // Two views of the day's open time: the full set (used to check a
    // candidate's footprint fits) and the grid set (stepped for starts). They
    // differ only by exact-start windows, which count as open time but must not
    // spawn a grid of starts inside themselves.
    const fitIntervals = dayOpenIntervals(weekday, dateKey, weeklyHours, overrides);
    const gridIntervals = dayOpenIntervals(weekday, dateKey, weeklyHours, overrides, { gridOnly: true });
    const trace: DayTrace = {
      dateKey,
      openMinutes: fitIntervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0),
      candidates: 0,
      bookable: 0,
      dropped: { past: 0, hours: 0, busy: 0, cap: 0, clockChange: 0 },
    };
    days.push(trace);
    if (!fitIntervals.length) continue;

    // Every start to consider: the grid across open blocks, plus each exact
    // slot's single time. Deduped so an exact time that also lands on the grid
    // isn't offered twice.
    const candidateMinutes = new Set<number>();
    for (const interval of gridIntervals) {
      for (let minute = interval.start; minute + SESSION_MINUTES <= interval.end; minute += slotMinutes) {
        candidateMinutes.add(minute);
      }
    }
    for (const minute of exactStartsOn(overrides, dateKey, weekday)) candidateMinutes.add(minute);

    for (const minute of [...candidateMinutes].sort((a, b) => a - b)) {
      // Null on the spring-forward Sunday, for the hour that doesn't happen.
      const candidate = londonTimeExact(y, m, d, Math.floor(minute / 60), minute % 60);
      trace.candidates++;
      if (!candidate) {
        trace.dropped.clockChange++;
        continue;
      }
      if (candidate < cutoff) {
        trace.dropped.past++;
        continue;
      }
      const fit = slotFits(candidate, minute, fitIntervals, clinic, busy, bufferMinutes, weeklyCap);
      if (fit !== "ok") {
        trace.dropped[fit]++;
        continue;
      }
      trace.bookable++;
      results.push(candidate);
    }
  }

  return { slots: results, days };
}

/** Real bookable slot start times: open hours minus busy time, minus past/too-soon. */
export function computeAvailableSlots(params: AvailabilityParams): Date[] {
  return computeAvailability(params).slots;
}

/**
 * One plain sentence for why a day has nothing bookable on it — or "" when it
 * has. Deliberately names the setting responsible, so the answer to "why is the
 * 12th empty?" is on the screen rather than at the end of an investigation.
 */
export function explainEmptyDay(trace: DayTrace): string {
  if (trace.bookable > 0) return "";
  if (trace.openMinutes === 0) return "No hours set for this day";
  if (trace.candidates === 0) return "The hours set are shorter than one session";
  const { past, hours, busy, cap, clockChange } = trace.dropped;
  // Reported worst-first: the cap and a full diary are the surprising answers,
  // the notice window and short hours are the expected ones.
  if (cap > 0 && cap >= busy) return "Weekly Chalk Farm hours cap reached for this week";
  if (busy > 0 && busy >= past) return "Everything's taken — busy time on your calendar, or gaps too small";
  if (past > 0) return "Too soon to book — inside your minimum-notice window";
  if (hours > 0) return "The hours set don't leave room for a full session";
  if (clockChange > 0) return "The clocks change on this day — those hours don't exist";
  return "Nothing bookable";
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
  const {
    clinic,
    weeklyHours,
    overrides,
    busy,
    bufferMinutes = 0,
    now = new Date(),
    minNoticeMinutes = 0,
    weeklyCap,
  } = params;
  const cutoff = new Date(now.getTime() + minNoticeMinutes * 60_000);
  if (candidate < cutoff) return false;

  const weekday = londonWeekdayIndex(candidate);
  const dateKey = londonDateKey(candidate);
  const intervals = dayOpenIntervals(weekday, dateKey, weeklyHours, overrides);
  if (!intervals.length) return false;

  const minute = londonMinutes(candidate);
  return slotFits(candidate, minute, intervals, clinic, busy, bufferMinutes, weeklyCap) === "ok";
}
