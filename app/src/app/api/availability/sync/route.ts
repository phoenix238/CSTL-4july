import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runAvailabilitySync } from "@/lib/google/availabilitySync";

/** Don't hammer Google when the calendar view remounts — one sync per minute is
 *  plenty for "picked up whenever you open the app". */
const THROTTLE_MS = 60_000;

/**
 * Run the availability ⇄ Google two-way sync now (pull Google edits back, then
 * push app state out). Called on the calendar view opening and by the Settings
 * "Sync now" button. Throttled so a burst of remounts collapses to one run;
 * `?force=1` skips the throttle for the explicit button.
 */
export const POST = guarded(async (req: Request) => {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const settings = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  if (!settings.availabilityCalendarId) {
    return NextResponse.json({ connected: false });
  }
  if (!force && settings.availabilityLastSyncAt && Date.now() - settings.availabilityLastSyncAt.getTime() < THROTTLE_MS) {
    return NextResponse.json({ connected: true, skipped: true, lastSyncAt: settings.availabilityLastSyncAt.toISOString() });
  }
  const result = await runAvailabilitySync();
  const after = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  return NextResponse.json({ connected: true, result, lastSyncAt: after.availabilityLastSyncAt?.toISOString() ?? null });
});
