import { beforeEach, expect, it, vi } from "vitest";
import { reviewInterruptedDeposits } from "./reviewInterruptedDeposits";

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), claim: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    bookingDeposit: { findMany: mocks.candidates },
    $transaction: async (fn: (tx: object) => unknown) => fn({
      bookingDeposit: { updateMany: mocks.claim },
      enquiry: { create: mocks.enqueue },
      booking: { findUnique: async () => ({ clientId: "client" }) },
    }),
  },
}));
vi.mock("@/lib/google/gmail", () => ({ sendEmail: async () => null }));

const now = new Date("2030-01-01T12:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.candidates.mockResolvedValue([{
    id: "deposit", bookingId: "booking", startsAt: now, email: "maya@example.test", name: "Maya",
  }]);
});

it("uses the confirmation start time and puts an interrupted payment in the client's review queue", async () => {
  mocks.claim.mockResolvedValue({ count: 1 });
  expect(await reviewInterruptedDeposits(now, "deposit")).toBe(1);
  expect(mocks.candidates).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      id: "deposit", state: "confirming",
      OR: expect.arrayContaining([{ confirmingAt: { lte: new Date("2030-01-01T11:45:00Z") } }]),
    }),
  }));
  expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ clientId: "client" }) });
});

it("skips a payment another request already confirmed or put into review", async () => {
  mocks.claim.mockResolvedValue({ count: 0 });
  expect(await reviewInterruptedDeposits(now)).toBe(0);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
