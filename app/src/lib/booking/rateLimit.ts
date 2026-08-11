import { prisma } from "@/lib/db";

/**
 * How many public bookings one person can make, and how quickly.
 *
 * Set well above what a real client does and well below what a script does.
 * Somebody booking two sessions back to back is normal; the same address
 * booking six times in an hour is not, and the cost of being wrong is a diary
 * full of fake sessions, a Drive full of junk folders, and a Gmail account
 * throttled for the sending spike.
 *
 * The daily ceiling is a backstop against a distributed run — many addresses,
 * many IPs, none of them individually over the per-key limit. For a solo
 * practice it sits far above a busy day.
 */
const LIMITS = [
  { scope: "email", windowMs: 60 * 60_000, max: 3 },
  { scope: "email", windowMs: 24 * 60 * 60_000, max: 5 },
  { scope: "ip", windowMs: 60 * 60_000, max: 5 },
  { scope: "ip", windowMs: 24 * 60 * 60_000, max: 15 },
] as const;

const DAILY_TOTAL_MAX = 40;

/** Attempts older than this are no longer counted by any limit, so they're pruned. */
const RETENTION_MS = 25 * 60 * 60_000;

/** Refused for booking too often — surfaced to the visitor as a 429. */
export class RateLimitedError extends Error {
  constructor() {
    super(
      "That's a few bookings in a short space of time. If you need another session, please get in touch with Phoenix directly and he'll sort it out.",
    );
    this.name = "RateLimitedError";
  }
}

/**
 * The client's IP as Vercel sees it. `x-forwarded-for` is a comma-separated
 * chain and the *first* entry is the original client; the rest are proxies.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Record this attempt and refuse if it puts anyone over a limit.
 *
 * Called before the booking does any real work — the point is to stop the Drive
 * folder, the calendar events and the email, not to undo them afterwards. The
 * attempt is recorded whether or not the booking then succeeds, so a script
 * that fails validation repeatedly still counts against its own ceiling.
 *
 * `record: false` checks the ceilings without adding to them. That's for the
 * second half of a booking the visitor has already been counted for — a
 * returning client confirming "yes, that's me" is finishing the attempt they
 * started, and charging them twice would let two taps exhaust a limit set at
 * three.
 */
export async function assertBookingAllowed(
  req: Request,
  email: string,
  { record = true }: { record?: boolean } = {},
): Promise<void> {
  const keys = { email: `email:${email.trim().toLowerCase()}`, ip: `ip:${clientIp(req)}` };
  const now = Date.now();

  if (record) {
    await prisma.bookingAttempt.createMany({
      data: [{ key: keys.email }, { key: keys.ip }],
    });
  }

  for (const limit of LIMITS) {
    const count = await prisma.bookingAttempt.count({
      where: { key: keys[limit.scope], createdAt: { gte: new Date(now - limit.windowMs) } },
    });
    if (count > limit.max) throw new RateLimitedError();
  }

  const dailyTotal = await prisma.bookingAttempt.count({
    where: { key: { startsWith: "email:" }, createdAt: { gte: new Date(now - 24 * 60 * 60_000) } },
  });
  if (dailyTotal > DAILY_TOTAL_MAX) throw new RateLimitedError();

  // Opportunistic cleanup so the table stays small without a scheduled job.
  // Non-fatal: a failure here must never stop a real client booking.
  try {
    await prisma.bookingAttempt.deleteMany({ where: { createdAt: { lt: new Date(now - RETENTION_MS) } } });
  } catch {
    /* housekeeping only */
  }
}
