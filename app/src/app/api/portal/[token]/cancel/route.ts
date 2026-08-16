import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings } from "@/lib/db";
import type { Clinic } from "@/lib/booking/rules";
import { cancelBookingEvents } from "@/lib/google/calendar";
import { suggestedGoodwillPence } from "@/lib/account";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { confirmToClient, notifyPhoenix } from "@/lib/portalNotify";
import { getOrCreatePaymentRef, portalUrl } from "@/lib/portal";

/**
 * Cancel the client's upcoming session.
 *
 * Always permitted, whatever the notice. Someone who can't come needs to be able
 * to say so — a portal that refuses just produces a no-show and a wasted room.
 * Short notice attaches a suggested goodwill contribution to the booking, which
 * is recorded but never treated as a debt.
 */
export const POST = portalRoute(async (_req, client) => {
  const settings = await getSettings();

  const booking = await prisma.booking.findFirst({
    where: { clientId: client.id, status: "confirmed", startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
  });
  if (!booking) {
    throw new PortalRuleError("You don't have a session booked to cancel.", 404);
  }

  const goodwill = suggestedGoodwillPence(
    booking.startsAt,
    settings.portalNoticeHours,
    settings.lateCancelGoodwillPence,
  );
  const whenLabel = `${fmtDayLong(booking.startsAt)} · ${fmtTime(booking.startsAt)}`;
  const clinic = booking.clinic as Clinic;

  // Frees the slot: deletes both Google events, marks the row cancelled, and
  // resyncs the Chalk Farm day block.
  await cancelBookingEvents(booking.id, "client");
  if (goodwill) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { goodwillPence: goodwill, goodwillReason: "late_cancel" },
    });
  }

  const paymentRef = goodwill ? await getOrCreatePaymentRef(client.id) : undefined;

  // Blind-copies Phoenix on the client's own confirmation, same as booking —
  // one email about one cancellation, not that email plus a separate summary.
  const notifyInput = {
    action: "cancelled" as const,
    clientName: client.name,
    clientEmail: client.email,
    clinic,
    whenLabel,
    goodwillPence: goodwill,
    paymentRef,
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

  return NextResponse.json({ whenLabel, goodwillPence: goodwill });
});
