import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { depositStripe, verifiedDepositPayment } from "./depositCheckout";

const hold = { id: "hold", stripeSessionId: "session", liveMode: false };
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

describe("depositStripe", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects live keys unless live deposits were explicitly enabled", () => {
    vi.stubEnv("STRIPE_ENABLE_LIVE_DEPOSITS", undefined);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_sample");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_sample");
    expect(() => depositStripe()).toThrow("not configured for this mode");
    vi.stubEnv("STRIPE_ENABLE_LIVE_DEPOSITS", "true");
    expect(depositStripe().liveMode).toBe(true);
    expect(() => depositStripe(false)).toThrow("mode mismatch");
  });

  it("never verifies a deposit using a session from the other mode", () => {
    const liveSession = { ...session, livemode: true } as Stripe.Checkout.Session;
    expect(verifiedDepositPayment(liveSession, { ...hold, liveMode: true })).toBe("pi_test");
    expect(verifiedDepositPayment(liveSession, hold)).toBeNull();
  });
});
