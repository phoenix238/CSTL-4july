import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { renameExistingSessionEvents } from "@/lib/google/calendar";

/**
 * One-off admin action: rename existing upcoming session events to the anonymous
 * title + clinic location, for bookings made before names came off the calendar.
 */
export const POST = guarded(async () => {
  const result = await renameExistingSessionEvents();
  return NextResponse.json(result);
});
