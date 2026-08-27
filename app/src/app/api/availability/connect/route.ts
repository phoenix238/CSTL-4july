import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureAvailabilityCalendar, runAvailabilitySync } from "@/lib/google/availabilitySync";

/**
 * Connect the dedicated "CSTL Availability" Google calendar and do the first
 * sync — creating the calendar (if needed) and materialising the current
 * bookable hours onto it. Idempotent: calling it again on an already-connected
 * account just re-syncs.
 */
export const POST = guarded(async () => {
  await ensureAvailabilityCalendar();
  const result = await runAvailabilitySync();
  const settings = await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  return NextResponse.json({
    connected: !!settings.availabilityCalendarId,
    lastSyncAt: settings.availabilityLastSyncAt?.toISOString() ?? null,
    result,
  });
});
