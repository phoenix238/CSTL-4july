import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { chalkFarmCapMinutes } from "@/lib/booking/availability";
import { loadBethnalWeeklyCap } from "@/lib/booking/slots";
import { londonAddDays, londonDateKey, londonMinutes, londonWeekStart } from "@/lib/time";

/**
 * How much of the weekly Chalk Farm cap is used, and what it would be if a
 * session were added at `start`. Powers the warning in Quick Book, since a
 * session booked by hand skips the slot list where the cap is normally applied.
 */
export const GET = guarded(async (req: Request) => {
  const start = new Date(new URL(req.url).searchParams.get("start") ?? "");
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid start" }, { status: 400 });
  }
  const settings = await getSettings();
  const cap = await loadBethnalWeeklyCap(start, londonAddDays(start, 1));
  if (!cap) return NextResponse.json({ capMinutes: 0, usedMinutes: 0, afterMinutes: 0 });

  const weekKey = londonDateKey(londonWeekStart(start));
  const dayStarts = cap.sessionMinsByDay[londonDateKey(start)] ?? [];
  const edge = settings.chalkFarmEdgeBufferMinutes;
  const gap = settings.chalkFarmClusterGapMinutes;
  const usedMinutes = cap.capMinutesByWeek[weekKey] ?? 0;
  const delta =
    chalkFarmCapMinutes([...dayStarts, londonMinutes(start)], edge, gap) - chalkFarmCapMinutes(dayStarts, edge, gap);
  return NextResponse.json({ capMinutes: cap.capMinutes, usedMinutes, afterMinutes: usedMinutes + delta });
});
