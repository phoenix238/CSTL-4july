import { prisma, getSettings } from "@/lib/db";
import { getBusySpans } from "@/lib/google/calendar";
import { londonAddDays, londonDayStart, londonDateKey, londonWeekStart } from "@/lib/time";
import { computeAvailableSlots, resolveWeeklyHours, type AvailabilityParams } from "./availability";
import { SESSION_MINUTES, type Clinic } from "./rules";

/**
 * Bethnal Green's weekly Chalk Farm hours cap, as a `computeAvailableSlots`-
 * ready `weeklyCap` — every *other* confirmed Bethnal session's minutes,
 * bucketed by the London calendar week (Mon-Sun) it falls in. Shared by
 * `loadAvailableSlots` and the offer-pick flow (`api/public/offer/[token]`),
 * which re-verifies a hand-picked time without going through that function.
 * Queries a week of margin either side of `windowStart`/`windowEnd` so every
 * week touched by that window is fully counted, not just the sessions that
 * happen to fall inside it.
 */
export async function loadBethnalWeeklyCap(
  windowStart: Date,
  windowEnd: Date,
  excludeBookingId?: string,
): Promise<AvailabilityParams["weeklyCap"]> {
  const settings = await getSettings();
  if (settings.chalkFarmWeeklyCapHours <= 0) return undefined;
  const weekBookings = await prisma.booking.findMany({
    where: {
      clinic: "bethnal",
      status: "confirmed",
      startsAt: { gte: londonAddDays(windowStart, -7), lt: londonAddDays(windowEnd, 7) },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { startsAt: true },
  });
  const bookedMinutesByWeek: Record<string, number> = {};
  for (const b of weekBookings) {
    const key = londonDateKey(londonWeekStart(b.startsAt));
    bookedMinutesByWeek[key] = (bookedMinutesByWeek[key] ?? 0) + SESSION_MINUTES;
  }
  return { capMinutes: settings.chalkFarmWeeklyCapHours * 60, bookedMinutesByWeek };
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
export async function loadAvailableSlots({
  clinic,
  windowStart,
  windowEnd,
  /** Ignore this booking's own footprint — so a client rescheduling can see the
   * slot they currently hold, and adjacent ones, as available. */
  excludeBookingId,
}: {
  clinic: Clinic;
  windowStart: Date;
  windowEnd: Date;
  excludeBookingId?: string;
}): Promise<Date[]> {
  const settings = await getSettings();
  const [overrides, busy, weeklyCap] = await Promise.all([
    prisma.availabilityOverride.findMany({
      where: { clinic, date: { gte: londonDateKey(windowStart), lt: londonDateKey(windowEnd) } },
    }),
    getBusySpans(windowStart, windowEnd),
    clinic === "bethnal" ? loadBethnalWeeklyCap(windowStart, windowEnd, excludeBookingId) : Promise.resolve(undefined),
  ]);

  return computeAvailableSlots({
    clinic,
    windowStart,
    windowEnd,
    weeklyHours: resolveWeeklyHours(settings.weeklyHours)[clinic],
    overrides: overrides.map((o) => ({
      date: o.date,
      kind: o.kind as "open" | "block",
      startMin: o.startMin,
      endMin: o.endMin,
    })),
    // The shared Chalk Farm room block spans the whole day's Bethnal sessions —
    // exclude it or a free gap between two sessions would look busy. A studio-mate's
    // real booking on that same calendar gets its own bigger safety gap instead.
    busy: busy
      .filter((b) => !b.roomBlock)
      .filter((b) => !excludeBookingId || b.bookingId !== excludeBookingId)
      .map((b) => ({
        ...b,
        bufferMinutes: b.source === "chalkFarm" ? settings.chalkFarmBufferMinutes : undefined,
      })),
    slotMinutes: settings.bookingSlotMinutes,
    // Waterloo and Bethnal Green don't need the same spacing between Phoenix's
    // own back-to-back sessions — kept as separate settings per clinic.
    bufferMinutes: clinic === "bethnal" ? settings.bethnalBufferMinutes : settings.bookingBufferMinutes,
    minNoticeMinutes: settings.bookingMinNoticeMins,
    weeklyCap,
  });
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
