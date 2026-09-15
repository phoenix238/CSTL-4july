import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { syncBankPayments } from "@/lib/payments/sync";
import {
  suggestClientByName,
  suggestClientByKnownReference,
  type NameCandidate,
  type KnownReferenceCandidate,
} from "@/lib/payments/match";
import { isStarlingConfigured } from "@/lib/starling";

/** Current state of payment matching, plus anything waiting to be assigned. */
export const GET = guarded(async () => {
  const [pending, recent, clients] = await Promise.all([
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
    prisma.client.findMany({ select: { id: true, name: true, knownReferences: true } }),
  ]);

  // Pre-suggest a client for each unassigned row — a one-tap confirm, never an
  // automatic credit. A row already attributed to a client keeps that; only rows
  // with no client get a suggestion. A repeat of free text they've typed before
  // is tried first (stronger evidence — it's specific to them), then the
  // sender's bank name as a fallback.
  const nameCandidates: NameCandidate[] = clients.map((c) => ({ clientId: c.id, name: c.name }));
  const refCandidates: KnownReferenceCandidate[] = clients
    .filter((c) => c.knownReferences.length)
    .map((c) => ({ clientId: c.id, knownReferences: c.knownReferences }));
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));
  const pendingWithSuggestions = pending.map((tx) => {
    if (tx.clientId) return { ...tx, suggestedClientId: null, suggestedClientName: null };
    const suggestedClientId =
      suggestClientByKnownReference(tx.reference ?? "", refCandidates) ??
      suggestClientByName(tx.counterParty ?? "", nameCandidates);
    return {
      ...tx,
      suggestedClientId,
      suggestedClientName: suggestedClientId ? nameOf.get(suggestedClientId) ?? null : null,
    };
  });

  return NextResponse.json({ configured: isStarlingConfigured(), pending: pendingWithSuggestions, recent });
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
