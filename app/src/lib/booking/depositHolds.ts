import type { Prisma } from "@prisma/client";
import { londonDateKey } from "@/lib/time";
import { SESSION_MINUTES } from "./rules";
import { SlotTakenError } from "./slotError";

const sessionMs = SESSION_MINUTES * 60_000;

export function activeDepositHolds(now = new Date()): Prisma.BookingDepositWhereInput {
  return { state: "holding", expiresAt: { gt: now } };
}

/** Serialize CRM writes that can claim overlapping times, including across midnight. */
export async function lockBookingTime(tx: Prisma.TransactionClient, startsAt: Date) {
  const days = new Set([
    londonDateKey(new Date(startsAt.getTime() - sessionMs)),
    londonDateKey(startsAt),
    londonDateKey(new Date(startsAt.getTime() + sessionMs)),
  ]);
  for (const day of [...days].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${day}`}))`;
  }
}

export async function assertUnclaimedBookingTime(
  tx: Prisma.TransactionClient,
  startsAt: Date,
  excludeBookingId?: string,
) {
  const overlap = {
    gt: new Date(startsAt.getTime() - sessionMs),
    lt: new Date(startsAt.getTime() + sessionMs),
  };
  const booking = await tx.booking.findFirst({
    where: { status: "confirmed", startsAt: overlap, ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) },
    select: { id: true },
  });
  const hold = await tx.bookingDeposit.findFirst({
    where: { ...activeDepositHolds(), startsAt: overlap },
    select: { id: true },
  });
  if (booking || hold) throw new SlotTakenError();
}
