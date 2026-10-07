import { prisma, getSettings, getSpaces } from "@/lib/db";
import { spaceById, type Space } from "@/lib/spaces";
import { getBusySpans, type BusySpan } from "@/lib/google/calendar";
import { londonAddDays, londonDayStart, londonDateKey, londonMinutes, londonTime, londonWeekStart } from "@/lib/time";
import { chalkFarmCapMinutes, computeAvailability, computeAvailableSlots, resolveWeeklyHours, weeklyHoursFor, type AvailabilityParams, type DayTrace, type OverrideWindow } from "./availability";
import { SESSION_MINUTES, type Clinic } from "./rules";

/**
 * A space's weekly hours cap, as a `computeAvailableSlots`-ready `weeklyCap` —
 * your own session hours there each London week (Mon-Sun),
 * counted one session length per confirmed session (gaps between them don't
 * count). Shared by `loadAvailableSlots` and the offer-pick flow
 * (`api/public/offer/[token]`), which re-verifies a hand-picked time without
 * going through that function. Queries a week of margin either side of
 * `windowStart`/`windowEnd` so every week touched by that window is fully
 * counted, not just the sessions that happen to fall inside it.
 */
export async function loadWeeklyCap(
  space: Space,
  windowStart: Date,
  windowEnd: Date,
  excludeBookingId?: string,
): Promise<AvailabilityParams["weeklyCap"]> {
  if (space.weeklyCapHours <= 0) return undefined;
  const weekBookings = await prisma.booking.findMany({
    where: {
      clinic: space.id,
      status: "confirmed",
      startsAt: { gte: londonAddDays(windowStart, -7), lt: londonAddDays(windowEnd, 7) },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { startsAt: true },
  });

  // Group confirmed sessions by London day (start times as minute-of-day), then
  // sum each day's session hours into its week — so the cap tracks the actual
  // Chalk Farm session time held, gaps between sessions excluded.
  const sessionMinsByDay: Record<string, number[]> = {};
  for (const b of weekBookings) {
    const dateKey = londonDateKey(b.startsAt);
    (sessionMinsByDay[dateKey] ??= []).push(londonMinutes(b.startsAt));
  }
  const capMinutesByWeek: Record<string, number> = {};
  for (const [dateKey, mins] of Object.entries(sessionMinsByDay)) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const weekKey = londonDateKey(londonWeekStart(londonTime(y, m, d, 12, 0)));
    capMinutesByWeek[weekKey] = (capMinutesByWeek[weekKey] ?? 0) + chalkFarmCapMinutes(mins);
  }
  return {
    capMinutes: space.weeklyCapHours * 60,
    capMinutesByWeek,
    sessionMinsByDay,
  };
}

/**
 * Does this busy span actually stop you working at `clinic`?
 *
 * Venue calendars are shared with other practitioners, so their events mean
 * "this *room* is taken", not "you are taken" — and a room at one space says
 * nothing about another. Your own time (your personal calendar, your own
 * bookings) always counts, wherever it is.
 */
function appliesToClinic(span: BusySpan, clinic: Clinic): boolean {
  if (span.source === "venue") return span.clinic === clinic;
  return true;
}

/**
 * The clearance to keep either side of one busy span.
 *
 * Three different gaps, because they're three different problems: getting across
 * London between the two clinics, not booking right onto a studio-mate's Chalk
 * Farm session, and simple breathing room between Phoenix's own back-to-back
 * clients. `undefined` means "use the clinic's own default".
 */
function spanBuffer(
  span: BusySpan,
  space: Space,
  settings: { crossClinicGapMinutes: number },
): number | undefined {
  const clinic = space.id;
  // A confirmed session at the *other* clinic — Phoenix has to physically get
  // there. This is what makes a Waterloo morning and a Bethnal Green evening
  // safe on the same day: the two are allowed to coexist, just not back to back.
  if (span.source === "booking" && span.clinic && span.clinic !== clinic) return settings.crossClinicGapMinutes;
  // Someone else's booking on a shared day-block venue calendar.
  if (span.source === "venue" && space.venueMode === "dayBlock") return space.venueBufferMinutes;
  return undefined;
}

/**
 * Turn raw busy spans into the ones that actually constrain `clinic`, each
 * carrying the right clearance. Shared by `loadAvailableSlots` and the
 * offer-pick route, which checks a hand-picked time without going through it —
 * the two drifting apart is exactly how a slot comes to look free on one
 * surface and refuse the booking on another.
 */
export function filterBusyForClinic(
  busy: BusySpan[],
  space: Space,
  settings: { crossClinicGapMinutes: number },
  excludeBookingId?: string,
): Array<BusySpan & { bufferMinutes?: number }> {
  return busy
    .filter((b) => !b.roomBlock)
    .filter((b) => !excludeBookingId || b.ownBookingId !== excludeBookingId)
    .filter((b) => appliesToClinic(b, space.id))
    .map((b) => ({ ...b, bufferMinutes: spanBuffer(b, space, settings) }));
}

/**
 * The one place that turns "what's bookable?" into real times.
 *
 * Every client-facing surface goes through here — the public /book page, the
 * client portal's next-session picker, and the re-verification both of them do
 * before actually writing a booking. Keeping it single-sourced is the point: if
 * the browse view and the write check could drift apart, a slot could look free
 * and then be refused, or worse, be taken twice.
 */
export async function loadAvailableSlots(args: {
  clinic: Clinic;
  windowStart: Date;
  windowEnd: Date;
  /** Ignore this booking's own footprint — so a client rescheduling can see the
   * slot they currently hold, and adjacent ones, as available. */
  excludeBookingId?: string;
}): Promise<Date[]> {
  return computeAvailableSlots(await availabilityParams(args));
}

/**
 * Every override that could touch a window, mapped to the shape the engine
 * wants.
 *
 * A one-off is only relevant if its date falls inside the window. A repeating
 * one is relevant to any window at or after the date it was drawn on, whatever
 * that date was — so the query can't be a plain date range, and both the slot
 * loader and the offer-pick route go through here rather than each writing
 * their own `where` and drifting apart (the mistake this whole file guards
 * against). `computeAvailability` decides which specific days each one lands on.
 */
export async function loadOverridesForWindow(
  clinic: Clinic,
  windowStart: Date,
  windowEnd: Date,
): Promise<OverrideWindow[]> {
  const rows = await prisma.availabilityOverride.findMany({
    where: {
      clinic,
      OR: [
        { date: { gte: londonDateKey(windowStart), lt: londonDateKey(windowEnd) } },
        { repeatWeekly: true, date: { lt: londonDateKey(windowEnd) } },
      ],
    },
  });
  return rows.map((o) => ({
    date: o.date,
    kind: o.kind as "open" | "block",
    startMin: o.startMin,
    endMin: o.endMin,
    repeatWeekly: o.repeatWeekly,
    exactStart: o.exactStart,
  }));
}

/** Gather everything `computeAvailability` needs for one clinic and window. */
async function availabilityParams({
  clinic,
  windowStart,
  windowEnd,
  excludeBookingId,
}: {
  clinic: Clinic;
  windowStart: Date;
  windowEnd: Date;
  excludeBookingId?: string;
}): Promise<AvailabilityParams> {
  const settings = await getSettings();
  const space = spaceById(await getSpaces(), clinic);
  const [overrides, busy, weeklyCap] = await Promise.all([
    loadOverridesForWindow(clinic, windowStart, windowEnd),
    getBusySpans(windowStart, windowEnd),
    loadWeeklyCap(space, windowStart, windowEnd, excludeBookingId),
  ]);

  return {
    clinic,
    windowStart,
    windowEnd,
    // An archived space offers nothing, whatever hours it still has saved.
    weeklyHours: space.active ? weeklyHoursFor(resolveWeeklyHours(settings.weeklyHours), clinic) : [],
    overrides: space.active ? overrides : [],
    busy: filterBusyForClinic(busy, space, settings, excludeBookingId),
    slotMinutes: settings.bookingSlotMinutes,
    // Each space keeps its own spacing between your own back-to-back sessions.
    bufferMinutes: space.bufferMinutes,
    minNoticeMinutes: settings.bookingMinNoticeMins,
    weeklyCap,
  };
}

/**
 * The same answer as `loadAvailableSlots`, plus the per-day account of how it
 * got there — for the admin calendar, which shows what a client can actually
 * book and explains any day where that's nothing.
 *
 * Goes through the identical path rather than recomputing: the whole point is
 * that the calendar and the booking page can't disagree.
 */
export async function loadAvailabilityWithTrace(args: {
  clinic: Clinic;
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ slots: Date[]; days: DayTrace[] }> {
  return computeAvailability(await availabilityParams(args));
}

/** The browsing window a client sees: today out to the booking horizon. */
export async function defaultSlotWindow() {
  const settings = await getSettings();
  return { windowStart: londonDayStart(0), windowEnd: londonDayStart(settings.bookingHorizonDays) };
}

/**
 * Re-verify a requested start against live availability, and fail closed.
 *
 * Never trust a posted time: the slot set is recomputed here, server-side, and
 * the booking only proceeds if the requested start is genuinely still in it.
 * Guards equally against a stale browser tab and a hand-crafted request.
 */
export async function assertSlotAvailable({
  clinic,
  start,
  excludeBookingId,
}: {
  clinic: Clinic;
  start: Date;
  excludeBookingId?: string;
}): Promise<void> {
  // A day either side of the requested time is plenty to place it correctly
  // (day-boundary and buffer effects are local) and far cheaper than the full horizon.
  const slots = await loadAvailableSlots({
    clinic,
    windowStart: londonDayStart(-1, start),
    windowEnd: londonDayStart(2, start),
    excludeBookingId,
  });
  if (!slots.some((s) => s.getTime() === start.getTime())) {
    throw new SlotTakenError();
  }
}

/** Thrown when a requested slot is no longer free — surfaced to the client as a 409. */
export class SlotTakenError extends Error {
  constructor() {
    super("That time isn't available anymore — please pick another.");
    this.name = "SlotTakenError";
  }
}
