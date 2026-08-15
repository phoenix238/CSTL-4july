import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { restyleExistingSessionEvents } from "@/lib/google/calendar";

/**
 * One-off admin action: bring existing upcoming session events in line with
 * what new bookings already get — the anonymous title, and the clinic's colour.
 */
export const POST = guarded(async () => {
  const result = await restyleExistingSessionEvents();
  return NextResponse.json(result);
});
