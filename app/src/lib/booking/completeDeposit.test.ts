import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlotTakenError } from "./slotError";
import { completeDeposit } from "./completeDeposit";

const mocks = vi.hoisted(() => {
  const hold = {
    id: "hold", stripeSessionId: "session", state: "holding",
    name: "Maya", email: "maya@example.test", phone: "", startsAt: new Date("2099-01-01T12:00:00Z"),
  };
  const deposit = {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  };
  const tx = {
    $executeRaw: vi.fn(),
    bookingDeposit: deposit,
    client: { findFirst: vi.fn(), create: vi.fn() },
    booking: { create: vi.fn() },
  };
  return {
    hold, deposit, tx,
    lock: vi.fn(), assertTime: vi.fn(), book: vi.fn(), refund: vi.fn(),
    transaction: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: { bookingDeposit: mocks.deposit, $transaction: mocks.transaction, enquiry: { create: vi.fn().mockResolvedValue(null) } },
  getSettings: async () => ({ bookingNotifyEmail: false }),
}));
vi.mock("@/lib/google/drive", () => ({ ensureClientFolderAndDoc: async () => null }));
vi.mock("@/lib/google/gmail", () => ({ sendEmail: vi.fn().mockResolvedValue(null) }));
vi.mock("./book", () => ({ bookSession: mocks.book }));
vi.mock("./depositHolds", () => ({ lockBookingTime: mocks.lock, assertUnclaimedBookingTime: mocks.assertTime }));
vi.mock("./depositCheckout", async (original) => ({
  ...await original<typeof import("./depositCheckout")>(),
  sandboxStripe: () => ({ stripe: { refunds: { create: mocks.refund } } }),
}));

const session = {
  id: "session", client_reference_id: "hold", mode: "payment", status: "complete",
  payment_status: "paid", currency: "gbp", amount_total: 1500, livemode: false, payment_intent: "payment",
} as Stripe.Checkout.Session;

describe("completeDeposit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(mocks.tx));
    mocks.deposit.findUnique.mockResolvedValue(mocks.hold);
    let current = { ...mocks.hold };
    mocks.deposit.findUniqueOrThrow.mockImplementation(async () => current);
    mocks.deposit.update.mockImplementation(async ({ data }) => {
      current = { ...current, ...data };
      return current;
    });
    mocks.tx.client.findFirst.mockResolvedValue(null);
    mocks.tx.client.create.mockResolvedValue({ id: "client" });
    mocks.tx.booking.create.mockResolvedValue({ id: "booking", clientId: "client" });
    mocks.book.mockResolvedValue({ emailSent: true });
    mocks.refund.mockResolvedValue({ status: "succeeded" });
  });

  it("ignores unpaid sessions", async () => {
    await completeDeposit({ ...session, payment_status: "unpaid" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates one booking and sends its welcome email once across repeated notifications", async () => {
    await completeDeposit(session);
    await completeDeposit(session);
    expect(mocks.tx.booking.create).toHaveBeenCalledTimes(1);
    expect(mocks.book).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ depositBookingId: "booking", sendEmail: true }));
    expect(mocks.deposit.update).toHaveBeenLastCalledWith({ where: { id: "hold" }, data: { state: "booked" } });
  });

  it("requests a full refund when a paid appointment cannot be booked", async () => {
    mocks.assertTime.mockRejectedValue(new SlotTakenError());
    await completeDeposit(session);
    expect(mocks.tx.booking.create).not.toHaveBeenCalled();
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith({ payment_intent: "payment" }, { idempotencyKey: "unbooked-deposit-hold" });
  });
});
