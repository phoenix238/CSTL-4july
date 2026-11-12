import Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ completeDeposit: vi.fn(), releaseExpiredDeposit: vi.fn() }));
const stripe = new Stripe("sk_test_sample");
vi.mock("@/lib/booking/completeDeposit", () => ({ completeDeposit: mocks.completeDeposit }));
vi.mock("@/lib/booking/depositCheckout", () => ({
  depositStripe: () => ({ stripe, liveMode: false }),
  releaseExpiredDeposit: mocks.releaseExpiredDeposit,
}));

const secret = "whsec_sample";
const session = { id: "cs_test_sample", client_reference_id: "sample", livemode: false };
function request(type: string, options: { validSignature?: boolean; livemode?: boolean } = {}) {
  const payload = JSON.stringify({
    type, livemode: options.livemode ?? false, data: { object: session },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload, secret: options.validSignature === false ? "whsec_wrong" : secret,
  });
  return new Request("https://example.test/api/public/deposit/webhook", {
    method: "POST", body: payload, headers: { "stripe-signature": signature },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
});
afterEach(() => vi.unstubAllEnvs());

it("forwards a signed sandbox completion to payment verification", async () => {
  expect((await POST(request("checkout.session.completed"))).status).toBe(200);
  expect(mocks.completeDeposit).toHaveBeenCalledExactlyOnceWith(session);
});

it("releases an expired checkout from a signed sandbox event", async () => {
  expect((await POST(request("checkout.session.expired"))).status).toBe(200);
  expect(mocks.releaseExpiredDeposit).toHaveBeenCalledExactlyOnceWith(session);
});

it.each([{ validSignature: false }, { livemode: true }])("rejects untrusted completion events (%j)", async (options) => {
  expect((await POST(request("checkout.session.completed", options))).status).toBe(400);
  expect(mocks.completeDeposit).not.toHaveBeenCalled();
});
