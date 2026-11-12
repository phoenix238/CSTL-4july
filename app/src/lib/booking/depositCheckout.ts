import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { assertUnclaimedBookingTime, lockBookingTime } from "./depositHolds";
import { assertSlotAvailable } from "./slots";
import { SlotTakenError } from "./slotError";

export const DEPOSIT_PENCE = 1500;
const checkoutLifetimeSeconds = 35 * 60;

export function sandboxStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!secretKey?.startsWith("sk_test_") || !publishableKey?.startsWith("pk_test_")) {
    throw new Error("Stripe sandbox checkout is not configured.");
  }
  return { stripe: new Stripe(secretKey, { timeout: 10_000, maxNetworkRetries: 1 }), publishableKey };
}

export async function openDepositCheckout(input: {
  start: Date;
  name: string;
  email: string;
  phone: string;
}) {
  const { stripe, publishableKey } = sandboxStripe();
  await assertSlotAvailable({ clinic: "bethnal", start: input.start, requireCalendars: true });

  const expirySeconds = Math.floor(Date.now() / 1000) + checkoutLifetimeSeconds;
  const expiresAt = new Date(expirySeconds * 1000);
  if (input.start <= expiresAt) throw new SlotTakenError();

  const hold = await prisma.$transaction(async (tx) => {
    await lockBookingTime(tx, input.start);
    await assertUnclaimedBookingTime(tx, input.start);
    return tx.bookingDeposit.create({
      data: {
        startsAt: input.start,
        expiresAt,
        name: input.name,
        email: input.email,
        phone: input.phone,
      },
    });
  });

  const checkout = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    redirect_on_completion: "never",
    mode: "payment",
    // Stripe offers card wallets on the card method where the device and domain qualify.
    allowed_payment_method_types: ["card"],
    adaptive_pricing: { enabled: false },
    customer_email: input.email,
    expires_at: expirySeconds,
    client_reference_id: hold.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: DEPOSIT_PENCE,
        product_data: { name: "Bethnal Green first appointment deposit" },
      },
    }],
  }, { idempotencyKey: `booking-deposit-${hold.id}` });

  if (checkout.livemode || !checkout.client_secret) throw new Error("Invalid Stripe sandbox checkout.");
  await prisma.bookingDeposit.update({
    where: { id: hold.id },
    data: { stripeSessionId: checkout.id },
  });

  return { id: hold.id, clientSecret: checkout.client_secret, publishableKey, expiresAt };
}

/** The Stripe session must match both the stored session and the hold it was created for. */
export function verifiedDepositPayment(
  session: Stripe.Checkout.Session,
  hold: { id: string; stripeSessionId: string | null },
) {
  if (
    session.id !== hold.stripeSessionId ||
    session.client_reference_id !== hold.id ||
    session.livemode !== false ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.currency !== "gbp" ||
    session.amount_total !== DEPOSIT_PENCE
  ) return null;
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
}
