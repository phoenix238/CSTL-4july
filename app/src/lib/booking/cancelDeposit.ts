import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { sandboxStripe } from "./depositCheckout";

import { depositCancellationText, type DepositCancellation } from "./depositCancellationText";

export async function cancelDeposit(
  deposit: { id: string; stripePaymentId: string },
  booking: { id: string; startsAt: Date; clientId: string },
  cancelledAt: Date,
): Promise<DepositCancellation> {
  let outcome: DepositCancellation = "late_review";
  if (booking.startsAt.getTime() - cancelledAt.getTime() >= 24 * 60 * 60_000) {
    try {
      const { stripe } = sandboxStripe();
      const refund = await stripe.refunds.create(
        { payment_intent: deposit.stripePaymentId },
        { idempotencyKey: `client-cancel-deposit-${deposit.id}` },
      );
      outcome = refund.status === "succeeded" || refund.status === "pending" ? "refund_requested" : "refund_review";
    } catch {
      outcome = "refund_review";
    }
  }

  await prisma.bookingDeposit.update({ where: { id: deposit.id }, data: { state: outcome } });
  if (outcome !== "refund_requested") {
    const text = `The client cancelled a Bethnal Green appointment. ${depositCancellationText(outcome)} Booking: ${booking.id}.`;
    await prisma.enquiry.create({ data: {
      via: "ONLINE", clinic: "bethnal", clientId: booking.clientId, text,
    } });
    if (process.env.ALLOWED_EMAIL) {
      await sendEmail(process.env.ALLOWED_EMAIL, "Bethnal Green deposit needs review", text)
        .catch(() => console.error("Could not email deposit review alert", booking.id));
    }
  }
  return outcome;
}
