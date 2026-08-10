import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { loadAvailabilityWithTrace } from "@/lib/booking/slots";
import { explainEmptyDay } from "@/lib/booking/availability";
import { londonDayStart } from "@/lib/time";
import type { Clinic } from "@/lib/booking/rules";

/**
 * What a client could actually book, for the admin calendar.
 *
 * Distinct from `/api/availability`, which returns busy spans — this returns
 * bookable *starts*, run through the same code as the public /book page, plus a
 * plain sentence for any day where there are none. The calendar used to draw
 * its green bands straight from the weekly hours, which meant it showed time
 * that wasn't bookable and never said why.
 */
export const GET = guarded(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const clinic = params.get("clinic");
  if (clinic !== "waterloo" && clinic !== "bethnal") {
    return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
  }
  const days = Math.min(Number(params.get("days") ?? "7") || 7, 42);
  const startParam = params.get("start");
  const from = startParam ? new Date(startParam) : new Date();
  if (Number.isNaN(from.getTime())) throw new Error("Invalid start date");

  const { slots, days: traces } = await loadAvailabilityWithTrace({
    clinic: clinic as Clinic,
    windowStart: londonDayStart(0, from),
    windowEnd: londonDayStart(days, from),
  });

  return NextResponse.json({
    slots: slots.map((d) => d.toISOString()),
    days: traces.map((t) => ({
      date: t.dateKey,
      bookable: t.bookable,
      openMinutes: t.openMinutes,
      reason: explainEmptyDay(t),
    })),
  });
});
