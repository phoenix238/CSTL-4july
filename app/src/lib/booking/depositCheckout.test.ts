import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { verifiedDepositPayment } from "./depositCheckout";

const hold = { id: "hold", stripeSessionId: "session" };
const session = {
  id: "session",
  client_reference_id: "hold",
  livemode: false,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "gbp",
  amount_total: 1500,
  payment_intent: "pi_test",
} satisfies Partial<Stripe.Checkout.Session>;

describe("verifiedDepositPayment", () => {
  it("accepts a completed £15 sandbox payment for the matching hold", () => {
    expect(verifiedDepositPayment(session as Stripe.Checkout.Session, hold)).toBe("pi_test");
  });

  it.each([
    { id: "wrong-session" },
    { client_reference_id: "another-hold" },
    { livemode: true },
    { mode: "setup" },
    { status: "open" },
    { payment_status: "unpaid" },
    { currency: "usd" },
    { amount_total: 1499 },
    { payment_intent: null },
  ])("rejects mismatched or unpaid checkout data (%j)", (change) => {
    expect(verifiedDepositPayment({ ...session, ...change } as Stripe.Checkout.Session, hold)).toBeNull();
  });
});
