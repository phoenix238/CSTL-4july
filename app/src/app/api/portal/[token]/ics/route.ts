import { NextResponse } from "next/server";
import { prisma, getSettings } from "@/lib/db";
import { portalRoute } from "@/lib/portalRoute";
import { SESSION_EVENT_TITLE, type Clinic } from "@/lib/booking/rules";
import { buildSessionIcs, sessionLocation } from "@/lib/calendarLinks";
import { portalUrl } from "@/lib/portal";

/**
 * Download one of the client's sessions as an .ics file — the universal way onto
 * Apple Calendar, Outlook and anything else, for a client who doesn't use Google
 * Calendar (where the invite already reaches them). The file carries alarms
 * matching the reminders they've chosen, so importing it brings their own
 * calendar's alerts with it.
 *
 * Guarded by the portal token like every other portal route, and scoped to this
 * client's own bookings — a token can never fetch anyone else's session.
 */
export const GET = portalRoute(async (req, client) => {
  const url = new URL(req.url);
  const bookingId = url.searchParams.get("b") ?? "";
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientId: client.id, status: "confirmed" },
  });
  if (!booking) {
    return NextResponse.json({ error: "That session isn't on your record." }, { status: 404 });
  }

  const [settings, full] = await Promise.all([
    getSettings(),
    prisma.client.findUniqueOrThrow({ where: { id: client.id }, select: { reminderLeadDays: true } }),
  ]);
  const clinic = booking.clinic as Clinic;
  const address = clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
  const portalLink = portalUrl(settings, client.portalToken);

  const ics = buildSessionIcs({
    uid: booking.id,
    start: booking.startsAt,
    title: SESSION_EVENT_TITLE,
    location: sessionLocation(clinic, address),
    description: `Craniosacral therapy with Phoenix Tanner. Manage this session: ${portalLink}`,
    reminderLeadDays: full.reminderLeadDays,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="session-${booking.id}.ics"`,
      // A moved session changes this file, so don't let a browser serve a stale one.
      "Cache-Control": "no-store",
    },
  });
});
