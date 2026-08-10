import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hasNarrative, resolveCaseHistory } from "@/lib/caseHistory";

export interface CaseHistoryRow {
  id: string;
  name: string;
  docId: string;
  /** already rebuilt onto the standard layout */
  formattedAt: string | null;
  intakeDone: boolean;
  /** the clinical sections have something in them */
  hasNarrative: boolean;
  sessions: number;
}

/** Every client and where their Doc stands — the worklist for the reformat pass. */
export const GET = guarded(async () => {
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      docId: true,
      intakeDone: true,
      caseHistory: true,
      caseHistoryFormattedAt: true,
      _count: { select: { notes: true } },
    },
  });

  const rows: CaseHistoryRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    docId: c.docId,
    formattedAt: c.caseHistoryFormattedAt?.toISOString() ?? null,
    intakeDone: c.intakeDone,
    hasNarrative: hasNarrative(resolveCaseHistory(c.caseHistory)),
    sessions: c._count.notes,
  }));

  return NextResponse.json({ rows });
});
