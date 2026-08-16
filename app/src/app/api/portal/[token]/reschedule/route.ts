import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings } from "@/lib/db";
import type { Clinic } from "@/lib/booking/rules";
import { assertSlotAvailable } from "@/lib/booking/slots";
import { rescheduleBooking } from "@/lib/booking/book";
import { canRescheduleSelf } from "@/lib/account";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { confirmToClient, notifyPhoenix } from "@/lib/portalNotify";
import { portalUrl } from "@/lib/portal";

/** Move the client's upcoming session. Body: { startISO } */
export const POST = portalRoute(async (req, client) => {
  const settings = await getSettings();
  const { startISO } = (await req.json()) as { startISO?: string };
  const start = startISO ? new Date(startISO) : null;
  if (!start || Number.isNaN(start.getTime()) || start <= new Date()) {
    throw new PortalRuleError("Please pick a time in the future.");
  }

  const booking = await prisma.booking.findFirst({
    where: { clientId: client.id, status: "confirmed", startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
  });
  if (!booking) {
    throw new PortalRuleError("You don't have a session booked to move.", 404);
  }

  // Re-checked here, not just in the UI. The button is hidden inside the notice
  // window, but a page left open since yesterday would still have it — and the
  // rule has to hold for the request, not the render.
  if (!canRescheduleSelf(booking.startsAt, settings.portalNoticeHours)) {
    throw new PortalRuleError(
      `Sessions can be moved up to ${settings.portalNoticeHours} hours beforehand. Message Phoenix directly and he'll sort it out.`,
    );
  }

  const clinic = booking.clinic as Clinic;
  // Excluding their own booking, since that's the slot they're moving off.
  await assertSlotAvailable({ clinic, start, excludeBookingId: booking.id });

  const result = await rescheduleBooking(booking.id, start.toISOString());

  // Blind-copies Phoenix on the client's own confirmation, same as booking —
  // one email about one move, not that email plus a separate summary.
  const notifyInput = {
    action: "rescheduled" as const,
    clientName: result.clientName,
    clientEmail: client.email,
    clinic,
    whenLabel: result.whenLabel,
    previousWhenLabel: result.previousWhenLabel,
    portalLink: portalUrl(settings, client.portalToken),
  };
  const bcc = settings.portalNotifyEmail ? process.env.ALLOWED_EMAIL || undefined : undefined;
  const { sent } = await confirmToClient(notifyInput, bcc);
  // …unless the client's copy never sent, in which case the Bcc didn't either
  // and this is the only way he finds out.
  if (!sent) {
    await notifyPhoenix({ ...notifyInput, emailFailed: true });
  }
  revalidateTag("shell");

  return NextResponse.json({ whenLabel: result.whenLabel });
});
