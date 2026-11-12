import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), expire: vi.fn(), retrieve: vi.fn(), release: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { bookingDeposit: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/booking/depositCheckout", () => ({
  sandboxStripe: () => ({ stripe: { checkout: { sessions: { expire: mocks.expire, retrieve: mocks.retrieve } } } }),
  releaseExpiredDeposit: mocks.release,
}));

const id = "3af27aa9-9f68-4725-b290-88e8e4e6b91a";
const sessionId = "cs_test_example";
function abandon() {
  return POST(new Request("https://example.test/api/public/deposit/abandon", {
    method: "POST", body: JSON.stringify({ id }),
  }));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue({ stripeSessionId: sessionId, state: "holding" });
});

it("expires the linked Stripe session before releasing the slot", async () => {
  const expired = { id: sessionId, status: "expired" };
  mocks.expire.mockResolvedValue(expired);
  expect(await (await abandon()).json()).toEqual({ released: true });
  expect(mocks.expire).toHaveBeenCalledExactlyOnceWith(sessionId);
  expect(mocks.release).toHaveBeenCalledExactlyOnceWith(expired);
});

it("keeps a slot reserved if payment finished before the close request", async () => {
  mocks.expire.mockRejectedValue(new Error("Already complete"));
  mocks.retrieve.mockResolvedValue({ id: sessionId, status: "complete" });
  expect(await (await abandon()).json()).toEqual({ released: false });
  expect(mocks.release).not.toHaveBeenCalled();
});
