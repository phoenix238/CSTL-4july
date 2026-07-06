import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { rescheduleBooking } from "@/lib/booking/book";
import { cancelBookingEvents } from "@/lib/google/calendar";

/** Cancel a booking — deletes its Google events and frees the slot. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await cancelBookingEvents(id);
  return NextResponse.json({ ok: true });
});

/** Reschedule a booking to a new start time. Body: { startISO } */
export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { startISO } = await req.json();
  if (!startISO) throw new Error("startISO is required");
  const result = await rescheduleBooking(id, startISO);
  return NextResponse.json(result);
});
