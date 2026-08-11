import { prisma } from "@/lib/db";

/**
 * Each of these clients' non-cancelled bookings mapped to its 1-based position
 * in their history, oldest first — so a dashboard row can show "session 6" and
 * mark a genuine first session (one with no earlier non-cancelled booking).
 *
 * This is what "new client" should mean on the schedule: not "we haven't sent
 * the welcome email yet" (which flips off the moment it sends), but "this is the
 * earliest session they have".
 */
export async function sessionOrdinals(clientIds: string[]): Promise<Map<string, number>> {
  const ordinalById = new Map<string, number>();
  const unique = [...new Set(clientIds)];
  if (!unique.length) return ordinalById;

  const all = await prisma.booking.findMany({
    where: { clientId: { in: unique }, status: { not: "cancelled" } },
    select: { id: true, clientId: true },
    orderBy: { startsAt: "asc" },
  });

  const seen = new Map<string, number>();
  for (const b of all) {
    const n = (seen.get(b.clientId) ?? 0) + 1;
    seen.set(b.clientId, n);
    ordinalById.set(b.id, n);
  }
  return ordinalById;
}
