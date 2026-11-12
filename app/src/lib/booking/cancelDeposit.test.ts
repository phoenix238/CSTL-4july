import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelDeposit } from "./cancelDeposit";

const mocks = vi.hoisted(() => ({
  refund: vi.fn(), update: vi.fn(), enquiry: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { bookingDeposit: { update: mocks.update }, enquiry: { create: mocks.enquiry } },
}));
vi.mock("@/lib/google/gmail", () => ({ sendEmail: async () => null }));
vi.mock("./depositCheckout", () => ({
  sandboxStripe: () => ({ stripe: { refunds: { create: mocks.refund } } }),
}));

const startsAt = new Date("2099-01-02T12:00:00Z");
const booking = { id: "booking", startsAt, clientId: "client" };
const deposit = { id: "hold", stripePaymentId: "payment" };

describe("cancelDeposit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.refund.mockResolvedValue({ status: "pending" });
  });

  it("requests the full original-payment refund at exactly 24 hours", async () => {
    expect(await cancelDeposit(deposit, booking, new Date("2099-01-01T12:00:00Z"))).toBe("refund_requested");
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(
      { payment_intent: "payment" }, { idempotencyKey: "client-cancel-deposit-hold" },
    );
    expect(mocks.enquiry).not.toHaveBeenCalled();
  });

  it("sends a cancellation one millisecond inside the cutoff for review", async () => {
    expect(await cancelDeposit(deposit, booking, new Date("2099-01-01T12:00:00.001Z"))).toBe("late_review");
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.enquiry).toHaveBeenCalledOnce();
  });

  it("queues review when Stripe declines the refund", async () => {
    mocks.refund.mockResolvedValue({ status: "failed" });
    expect(await cancelDeposit(deposit, booking, new Date("2099-01-01T11:00:00Z"))).toBe("refund_review");
    expect(mocks.enquiry).toHaveBeenCalledOnce();
  });
});
