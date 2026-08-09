import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Clinic } from "@/lib/booking/rules";
import { defaultSlotWindow, loadAvailableSlots } from "@/lib/booking/slots";
import { portalRoute } from "@/lib/portalRoute";

/**
 * Bookable times for this client. Returns starts only — never a busy-span title,
 * never another client's name, never anything about the wider schedule.
 */
export const GET = portalRoute(async (req, client) => {
  const clinic = new URL(req.url).searchParams.get("clinic");
  if (clinic !== "waterloo" && clinic !== "bethnal") {
    return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
  }

  // Their own upcoming session shouldn't block them: rescheduling means moving
  // off it, and booking a new one replaces it. Derived here rather than accepted
  // from the request — a booking id supplied by the caller would be a way to
  // punch a hole in *someone else's* slot.
  const own = await prisma.booking.findFirst({
    where: { clientId: client.id, status: "confirmed", startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });

  const { windowStart, windowEnd } = await defaultSlotWindow();
  const slots = await loadAvailableSlots({
    clinic: clinic as Clinic,
    windowStart,
    windowEnd,
    excludeBookingId: own?.id,
  });

  return NextResponse.json({ slots: slots.map((d) => d.toISOString()) });
});
