import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rescheduleBooking } from "@/lib/booking/book";
import { cancelBookingEvents } from "@/lib/google/calendar";

/** A session that's already confirmed and hasn't started yet — the only kind that can still be changed. */
async function assertStillUpcoming(id: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id } });
  if (booking.status !== "confirmed" || booking.startsAt.getTime() <= Date.now()) {
    throw new Error("This session has already happened — nothing to change.");
  }
}

/** Cancel a booking — deletes its Google events and frees the slot. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await assertStillUpcoming(id);
  await cancelBookingEvents(id, "admin");
  return NextResponse.json({ ok: true });
});

/** Reschedule a booking to a new start time. Body: { startISO } */
export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { startISO } = await req.json();
  if (!startISO) throw new Error("startISO is required");
  await assertStillUpcoming(id);
  const result = await rescheduleBooking(id, startISO);
  return NextResponse.json(result);
});
