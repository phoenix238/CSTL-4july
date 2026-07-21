import { NextResponse } from "next/server";
import { prisma, getSettings } from "@/lib/db";
import { getBusySpans } from "@/lib/google/calendar";
import { londonDayStart, londonDateKey } from "@/lib/time";
import { computeAvailableSlots, resolveWeeklyHours } from "@/lib/booking/availability";
import type { Clinic } from "@/lib/booking/rules";

// NOT guarded — public read of bookable times only. Never returns busy-span
// titles or client names (computeAvailableSlots only ever sees start/end).
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const clinic = params.get("clinic");
    if (clinic !== "waterloo" && clinic !== "bethnal") {
      return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
    }

    const settings = await getSettings();
    const windowStart = londonDayStart(0);
    const windowEnd = londonDayStart(settings.bookingHorizonDays);

    const [overrides, busy] = await Promise.all([
      prisma.availabilityOverride.findMany({
        where: { clinic, date: { gte: londonDateKey(windowStart), lt: londonDateKey(windowEnd) } },
      }),
      getBusySpans(windowStart, windowEnd),
    ]);

    const slots = computeAvailableSlots({
      clinic: clinic as Clinic,
      windowStart,
      windowEnd,
      weeklyHours: resolveWeeklyHours(settings.weeklyHours)[clinic as Clinic],
      overrides: overrides.map((o) => ({ date: o.date, kind: o.kind as "open" | "block", startMin: o.startMin, endMin: o.endMin })),
      // The shared Chalk Farm room block spans the whole day's Bethnal
      // sessions — exclude it or a new slot between two sessions would look
      // "busy" even though the room's actually free right then. A studio-mate's
      // real booking on that same calendar gets its own bigger safety gap.
      busy: busy
        .filter((b) => !b.roomBlock)
        .map((b) => ({ ...b, bufferMinutes: b.source === "chalkFarm" ? settings.chalkFarmBufferMinutes : undefined })),
      slotMinutes: settings.bookingSlotMinutes,
      bufferMinutes: settings.bookingBufferMinutes,
      minNoticeMinutes: settings.bookingMinNoticeMins,
    });

    return NextResponse.json({ slots: slots.map((d) => d.toISOString()) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't load availability" }, { status: 500 });
  }
}
