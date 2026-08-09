import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { syncBankPayments } from "@/lib/payments/sync";
import { isStarlingConfigured } from "@/lib/starling";

/** Current state of payment matching, plus anything waiting to be assigned. */
export const GET = guarded(async () => {
  const [pending, recent] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { status: { in: ["unmatched", "ambiguous"] } },
      orderBy: { transactedAt: "desc" },
      take: 25,
    }),
    prisma.bankTransaction.findMany({
      where: { status: "matched" },
      orderBy: { transactedAt: "desc" },
      take: 10,
    }),
  ]);
  return NextResponse.json({ configured: isStarlingConfigured(), pending, recent });
});

/**
 * Check the bank now. `force` runs even when matching is switched off, so the
 * Settings button can be used to try it out before committing to it.
 */
export const POST = guarded(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const summary = await syncBankPayments({ force: Boolean(body?.force) });
  return NextResponse.json(summary);
});
