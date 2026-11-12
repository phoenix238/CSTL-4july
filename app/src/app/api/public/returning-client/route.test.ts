import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn(), book: vi.fn(), email: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { client: { findMany: mocks.findMany }, enquiry: { create: mocks.create } },
  getSettings: async () => ({ appUrl: "https://example.test" }),
}));
vi.mock("@/lib/booking/rateLimit", () => ({ assertBookingAllowed: async () => {} }));
vi.mock("@/lib/booking/slots", () => ({ assertSlotAvailable: async () => {} }));
vi.mock("@/lib/booking/book", () => ({ bookSession: mocks.book }));
vi.mock("@/lib/google/gmail", () => ({ sendEmail: mocks.email }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.book.mockResolvedValue({ clientId: "booked-client", bookingId: "booking", whenLabel: "Thursday at noon · Bethnal Green" });
  mocks.create.mockResolvedValue({ id: "review" });
});

const input = {
  name: "Maya Sample", email: "new@example.test", phone: "+44 7700 900101",
  clinic: "bethnal", startISO: "2099-01-01T12:00:00Z",
};
const client = { id: "existing", name: "maya  sample", phone: "07700 900101" };

function submit() {
  return POST(new Request("https://example.test/api/public/returning-client", {
    method: "POST", body: JSON.stringify(input),
  }));
}

it("books on the unique matching profile and sends a replyable review to Phoenix", async () => {
  vi.stubEnv("ALLOWED_EMAIL", "owner@example.test");
  try {
    mocks.findMany.mockResolvedValue([client]);
    const response = await submit();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ booked: true });
    expect(mocks.book).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      clientId: "existing", newClient: undefined, sendEmail: false, prepareEmailForClipboard: false,
    }));
    expect(mocks.email).toHaveBeenCalledExactlyOnceWith(
      "owner@example.test", expect.any(String), expect.stringContaining("/clients/booked-client"),
      undefined, undefined, { replyTo: input.email },
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([{ candidates: [] }, { candidates: [client, { ...client, id: "duplicate" }] }])("makes a separate record when there is no unique match (%j)", async ({ candidates }) => {
  mocks.findMany.mockResolvedValue(candidates);
  const response = await submit();
  expect(response.status).toBe(201);
  expect(mocks.book).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    clientId: undefined, newClient: { name: input.name, email: input.email, phone: input.phone },
  }));
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
    clientId: "booked-client", text: expect.stringContaining("Review a possible duplicate"),
  }) });
});
