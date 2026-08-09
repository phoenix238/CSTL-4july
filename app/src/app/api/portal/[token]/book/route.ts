import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings } from "@/lib/db";
import type { Clinic } from "@/lib/booking/rules";
import { assertSlotAvailable } from "@/lib/booking/slots";
import { bookSession } from "@/lib/booking/book";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { notifyPhoenix } from "@/lib/portalNotify";
import { portalUrl } from "@/lib/portal";

/** Book the client's next session themselves. Body: { clinic, startISO } */
export const POST = portalRoute(async (req, client) => {
  const settings = await getSettings();
  if (!settings.portalSelfBook) {
    throw new PortalRuleError("Online booking is turned off at the moment — please message Phoenix to arrange a time.", 403);
  }

  const { clinic, startISO } = (await req.json()) as { clinic?: string; startISO?: string };
  if (clinic !== "waterloo" && clinic !== "bethnal") {
    return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
  }
  const start = startISO ? new Date(startISO) : null;
  if (!start || Number.isNaN(start.getTime()) || start <= new Date()) {
    throw new PortalRuleError("Please pick a time in the future.");
  }

  // Their current upcoming session doesn't block them — bookSession replaces it.
  const own = await prisma.booking.findFirst({
    where: { clientId: client.id, status: "confirmed", startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
  await assertSlotAvailable({ clinic: clinic as Clinic, start, excludeBookingId: own?.id });

  // bookSession sends the client their own confirmation (calendar invite, address,
  // payment details), so there's no separate confirmToClient here — one email, not two.
  const result = await bookSession({
    clientId: client.id,
    clinic: clinic as Clinic,
    startISO: start.toISOString(),
    sendEmail: true,
    sendPayment: true,
    bookedVia: "portal",
  });

  await notifyPhoenix({
    action: "booked",
    clientName: result.clientName,
    clientEmail: client.email,
    clinic: clinic as Clinic,
    whenLabel: result.whenLabel,
    portalLink: portalUrl(settings, client.portalToken),
  });

  // Surface it in the in-app inbox too, so it isn't invisible if the notification
  // email is missed. Non-fatal — the booking has already happened.
  try {
    await prisma.enquiry.create({
      data: {
        via: "PORTAL",
        name: result.clientName,
        text: `Booked from their client page — ${result.whenLabel}`,
        status: "booked_online",
        clientId: client.id,
      },
    });
    revalidateTag("shell");
  } catch (err) {
    console.error("Couldn't record the portal booking in the inbox", err);
  }

  return NextResponse.json({ whenLabel: result.whenLabel });
});
