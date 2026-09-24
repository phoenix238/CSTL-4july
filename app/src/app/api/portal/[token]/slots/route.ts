import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseSessionType, type Clinic } from "@/lib/booking/rules";
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
  const params = new URL(req.url).searchParams;
  const moving = params.get("moving") === "1";
  // Which of their sessions is being moved, when they hold more than one. Still
  // scoped to this client's own confirmed future rows, so it can't name anyone
  // else's; falls back to the soonest, as before.
  const movingId = params.get("b") ?? undefined;
  const own = moving
    ? await prisma.booking.findFirst({
        where: {
          clientId: client.id,
          status: "confirmed",
          startsAt: { gt: new Date() },
          ...(movingId ? { id: movingId } : {}),
        },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, sessionType: true },
      })
    : null;
  // A moved session keeps its own length; a new one is whatever they picked
  // (60-minute craniosacral unless they chose the Clean Language session).
  const sessionType = own ? parseSessionType(own.sessionType) : parseSessionType(params.get("type"));

  const { windowStart, windowEnd } = await defaultSlotWindow();
  const slots = await loadAvailableSlots({
    clinic: clinic as Clinic,
    windowStart,
    windowEnd,
    excludeBookingId: own?.id,
    sessionType,
  });

  // Excluding their own booking above frees its time again, so it would otherwise
  // reappear as a bookable slot — "move to the time you're already on". Drop it
  // from the options and hand it back separately, so the page can show it as
  // their current time rather than a choice.
  const currentSlotISO = own?.startsAt.toISOString() ?? null;
  const offered = currentSlotISO ? slots.filter((d) => d.toISOString() !== currentSlotISO) : slots;

  return NextResponse.json({ slots: offered.map((d) => d.toISOString()), currentSlotISO });
});
