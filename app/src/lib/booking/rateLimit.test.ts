import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bookingAttempt = {
  createMany: vi.fn(),
  count: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: { bookingAttempt } }));

const makeReq = (ip = "1.2.3.4") => new Request("http://example.com", { headers: { "x-forwarded-for": ip } });

/** Re-imports the module with a given env, since the bypass lists are parsed once at module load. */
async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("./rateLimit");
}

describe("assertBookingAllowed", () => {
  beforeEach(() => {
    bookingAttempt.createMany.mockReset().mockResolvedValue(undefined);
    bookingAttempt.count.mockReset().mockResolvedValue(0);
    bookingAttempt.deleteMany.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_BYPASS_EMAILS;
    delete process.env.RATE_LIMIT_BYPASS_IPS;
  });

  it("checks the database for an ordinary visitor", async () => {
    const { assertBookingAllowed } = await loadWithEnv({});
    await assertBookingAllowed(makeReq(), "someone@example.com");
    expect(bookingAttempt.createMany).toHaveBeenCalled();
    expect(bookingAttempt.count).toHaveBeenCalled();
  });

  it("skips the database entirely for a bypassed email, case- and whitespace-insensitively", async () => {
    const { assertBookingAllowed } = await loadWithEnv({ RATE_LIMIT_BYPASS_EMAILS: "Test@Example.com" });
    await assertBookingAllowed(makeReq(), "  test@example.com  ");
    expect(bookingAttempt.createMany).not.toHaveBeenCalled();
    expect(bookingAttempt.count).not.toHaveBeenCalled();
  });

  it("skips the database entirely for a bypassed IP", async () => {
    const { assertBookingAllowed } = await loadWithEnv({ RATE_LIMIT_BYPASS_IPS: "9.9.9.9" });
    await assertBookingAllowed(makeReq("9.9.9.9"), "someone-else@example.com");
    expect(bookingAttempt.createMany).not.toHaveBeenCalled();
    expect(bookingAttempt.count).not.toHaveBeenCalled();
  });

  it("supports more than one bypassed address in the comma-separated list", async () => {
    const { assertBookingAllowed } = await loadWithEnv({ RATE_LIMIT_BYPASS_EMAILS: "a@example.com, b@example.com" });
    await assertBookingAllowed(makeReq(), "b@example.com");
    expect(bookingAttempt.createMany).not.toHaveBeenCalled();
  });

  it("still enforces the limit for everyone else when a bypass list is set", async () => {
    const { assertBookingAllowed, RateLimitedError } = await loadWithEnv({
      RATE_LIMIT_BYPASS_EMAILS: "phoenix@example.com",
    });
    bookingAttempt.count.mockResolvedValue(10); // over every limit
    await expect(assertBookingAllowed(makeReq(), "someone-else@example.com")).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });
});
