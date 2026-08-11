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

  // When they're moving a session, their own booking shouldn't block them —
  // rescheduling means moving off it, so it and its paired room event are
  // excluded. When they're adding one, it's ordinary busy time and stays.
  // Derived here rather than accepted from the request: a booking id supplied by
  // the caller would be a way to punch a hole in *someone else's* slot.
  const moving = new URL(req.url).searchParams.get("moving") === "1";
  const own = moving
    ? await prisma.booking.findFirst({
        where: { clientId: client.id, status: "confirmed", startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true },
      })
    : null;

  const { windowStart, windowEnd } = await defaultSlotWindow();
  const slots = await loadAvailableSlots({
    clinic: clinic as Clinic,
    windowStart,
    windowEnd,
    excludeBookingId: own?.id,
  });

  // Excluding their own booking above frees its time again, so it would otherwise
  // reappear as a bookable slot — "move to the time you're already on". Drop it
  // from the options and hand it back separately, so the page can show it as
  // their current time rather than a choice.
  const currentSlotISO = own?.startsAt.toISOString() ?? null;
  const offered = currentSlotISO ? slots.filter((d) => d.toISOString() !== currentSlotISO) : slots;

  return NextResponse.json({ slots: offered.map((d) => d.toISOString()), currentSlotISO });
});
