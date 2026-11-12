import { beforeEach, expect, it, vi } from "vitest";
import { rescheduleBooking } from "./book";
import { SlotTakenError } from "./slotError";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), lock: vi.fn(), assertTime: vi.fn(), removeEvents: vi.fn(), createEvents: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { findUniqueOrThrow: mocks.find },
    $transaction: async (callback: (tx: object) => unknown) => callback({ booking: { updateMany: mocks.update } }),
  },
}));
vi.mock("@/lib/clients", () => ({}));
vi.mock("@/lib/google/calendar", () => ({
  deleteBookingGoogleEvents: mocks.removeEvents, createBookingEvents: mocks.createEvents,
}));
vi.mock("@/lib/google/chalkFarm", () => ({}));
vi.mock("./depositHolds", () => ({ lockBookingTime: mocks.lock, assertUnclaimedBookingTime: mocks.assertTime }));

const previous = new Date("2030-01-02T12:00:00Z");
const target = new Date("2030-01-02T15:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue({
    status: "confirmed", startsAt: previous, rescheduleCount: 0,
    clientId: "client", clinic: "bethnal", client: { name: "Maya" },
  });
  mocks.update.mockResolvedValue({ count: 1 });
});

it("preserves the current appointment if checkout holds the destination", async () => {
  mocks.assertTime.mockRejectedValue(new SlotTakenError());
  await expect(rescheduleBooking("booking", target.toISOString())).rejects.toBeInstanceOf(SlotTakenError);
  expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), target);
  expect(mocks.assertTime).toHaveBeenCalledWith(expect.anything(), target, "booking");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.removeEvents).not.toHaveBeenCalled();
});

it("leaves calendar events alone after a competing move wins", async () => {
  mocks.update.mockResolvedValue({ count: 0 });
  await expect(rescheduleBooking("booking", target.toISOString())).rejects.toBeInstanceOf(SlotTakenError);
  expect(mocks.removeEvents).not.toHaveBeenCalled();
});

it("keeps the original booking and payment record when claiming a free destination", async () => {
  await rescheduleBooking("booking", target.toISOString());
  const { data } = mocks.update.mock.calls[0][0];
  expect(data).toMatchObject({ startsAt: target, rescheduleCount: { increment: 1 } });
  expect(data).not.toHaveProperty("depositPence");
  expect(mocks.removeEvents).toHaveBeenCalledOnce();
  expect(mocks.createEvents).toHaveBeenCalledExactlyOnceWith("booking");
});
