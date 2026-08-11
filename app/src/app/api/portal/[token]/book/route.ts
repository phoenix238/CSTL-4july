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

  // This route adds a session; it doesn't move one. So the client's existing
  // booking is real busy time here and blocks normally — moving is what
  // /reschedule is for, and that route excludes the booking being moved.
  await assertSlotAvailable({ clinic: clinic as Clinic, start });

  // bookSession sends the client their own confirmation (calendar invite, address,
  // payment details), so there's no separate confirmToClient here — one email, not two.
  const result = await bookSession({
    clientId: client.id,
    clinic: clinic as Clinic,
    startISO: start.toISOString(),
    sendEmail: true,
    sendPayment: true,
    bookedVia: "portal",
    // Booking a next session must never quietly delete the session they already
    // have — /reschedule is the route that moves one.
    replaceUpcoming: false,
    // Blind-copies Phoenix on that same confirmation. It used to be followed by
    // a separate "X booked a session" note, so one client booking one session
    // put two emails in his inbox.
    notifyOwner: settings.portalNotifyEmail,
  });

  // …unless the client's copy never sent, in which case the Bcc didn't either
  // and this is the only way he finds out.
  if (!result.emailSent) {
    await notifyPhoenix({
      action: "booked",
      clientName: result.clientName,
      clientEmail: client.email,
      clinic: clinic as Clinic,
      whenLabel: result.whenLabel,
      portalLink: portalUrl(settings, client.portalToken),
      emailFailed: true,
    });
  }

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
