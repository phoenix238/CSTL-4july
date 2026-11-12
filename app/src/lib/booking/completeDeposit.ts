import type Stripe from "stripe";
import { prisma, getSettings } from "@/lib/db";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { ensureClientFolderAndDoc } from "@/lib/google/drive";
import { sendEmail } from "@/lib/google/gmail";
import { bookSession } from "./book";
import { sandboxStripe, verifiedDepositPayment } from "./depositCheckout";
import { assertUnclaimedBookingTime, lockBookingTime } from "./depositHolds";
import { SlotTakenError } from "./slotError";

export async function completeDeposit(session: Stripe.Checkout.Session) {
  const id = session.client_reference_id;
  if (!id) return;
  const hold = await prisma.bookingDeposit.findUnique({ where: { id } });
  if (!hold) return;
  const paymentId = verifiedDepositPayment(session, hold);
  if (!paymentId) return;

  const booking = await prisma.$transaction(async (tx) => {
    await lockBookingTime(tx, hold.startsAt);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-email:${hold.email.toLowerCase()}`}))`;
    const current = await tx.bookingDeposit.findUniqueOrThrow({ where: { id } });
    if (current.state !== "holding") return null;

    try {
      if (hold.startsAt <= new Date()) throw new SlotTakenError();
      await assertUnclaimedBookingTime(tx, hold.startsAt, undefined, id);
      const existing = await tx.client.findFirst({
        where: { email: { equals: hold.email, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing) throw new SlotTakenError();
    } catch (error) {
      if (!(error instanceof SlotTakenError)) throw error;
      await tx.bookingDeposit.update({
        where: { id }, data: { state: "refund_required", stripePaymentId: paymentId },
      });
      return null;
    }

    const client = await tx.client.create({
      data: { name: hold.name, email: hold.email, phone: hold.phone, clinic: "bethnal" },
    });
    const created = await tx.booking.create({
      data: { clientId: client.id, startsAt: hold.startsAt, clinic: "bethnal", bookedVia: "online" },
    });
    await tx.bookingDeposit.update({
      where: { id }, data: { state: "confirming", stripePaymentId: paymentId, bookingId: created.id },
    });
    return created;
  });

  if (!booking) {
    const current = await prisma.bookingDeposit.findUniqueOrThrow({ where: { id } });
    if (current.state === "refund_required") {
      const { stripe } = sandboxStripe();
      const refund = await stripe.refunds.create(
        { payment_intent: paymentId },
        { idempotencyKey: `unbooked-deposit-${id}` },
      );
      if (refund.status === "failed" || refund.status === "canceled") {
        throw new Error("Stripe could not refund an unbooked deposit.");
      }
      await prisma.bookingDeposit.update({ where: { id }, data: { state: "refund_requested" } });
    }
    return;
  }

  try {
    const settings = await getSettings();
    const result = await bookSession({
      depositBookingId: booking.id,
      clientId: booking.clientId,
      clinic: "bethnal",
      startISO: hold.startsAt.toISOString(),
      sendEmail: true,
      sendPayment: true,
      notifyOwner: settings.bookingNotifyEmail,
    });
    await prisma.bookingDeposit.update({ where: { id }, data: { state: "booked" } });
    if (!result.emailSent) await alertPhoenix(hold, "Booking confirmed, but the welcome email could not be sent.");
  } catch {
    await prisma.bookingDeposit.update({ where: { id }, data: { state: "booking_review" } });
    await alertPhoenix(hold, "The deposit was paid and the slot is in the CRM. Check the diary and finish confirming the booking.");
  }

  await ensureClientFolderAndDoc(booking.clientId).catch(() => {
    console.error("Could not set up Drive for paid booking", booking.id);
  });
}

async function alertPhoenix(hold: { name: string; email: string; startsAt: Date }, message: string) {
  const when = `${fmtDayLong(hold.startsAt)} · ${fmtTime(hold.startsAt)}`;
  await prisma.enquiry.create({
    data: { via: "ONLINE", name: hold.name, clinic: "bethnal", text: `${message}\n${when}\n${hold.email}` },
  }).catch(() => console.error("Could not save deposit booking alert"));
  if (process.env.ALLOWED_EMAIL) {
    await sendEmail(process.env.ALLOWED_EMAIL, "Bethnal Green booking needs attention", `${message}\n${when}\n${hold.email}`)
      .catch(() => console.error("Could not email deposit booking alert"));
  }
}
