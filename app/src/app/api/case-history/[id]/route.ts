import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { extractCaseHistory } from "@/lib/claude";
import { ensureClientFolderAndDoc } from "@/lib/google/drive";
import {
  applyExtract,
  captureOriginalRecord,
  entryLabel,
  hasHistory,
  renderCaseHistoryDoc,
  resolveCaseHistory,
  resolveIntakeSnapshot,
  seedFromIntake,
} from "@/lib/caseHistory";

export const maxDuration = 60;

/**
 * Put one client's Doc onto the standard case-history layout.
 *
 * Three steps, in order, and each is safe to repeat:
 *   1. capture what the Doc holds today, whole;
 *   2. sort that text into the numbered sections (skipped once they're filled,
 *      unless `reread` — a section already written by hand is never overwritten);
 *   3. rewrite the Doc from the record, with the captured text kept underneath
 *      as ORIGINAL RECORD.
 *
 * The Doc keeps its id and its link throughout — this rewrites the contents of
 * the Doc the client is already attached to, it doesn't make a new one.
 */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { reread = false } = await req.json().catch(() => ({}) as { reread?: boolean });

  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  const { docId } = await ensureClientFolderAndDoc(id);

  const original = await captureOriginalRecord(docId);

  let history = resolveCaseHistory(client.caseHistory);
  let filled: string[] = [];
  let recoveredSessions = 0;
  let readError = "";

  // Reading the old text is the part that can fail (it's a model call) — when it
  // does, the Doc still gets its headers and still keeps every word it had.
  if (original && (reread || !hasHistory(history))) {
    try {
      const extract = await extractCaseHistory(client.name, original);
      const merged = applyExtract(history, extract);
      history = merged.history;
      filled = merged.filled.map(entryLabel);
      recoveredSessions = history.priorSessions?.length ?? 0;
    } catch (err) {
      readError = err instanceof Error ? err.message : "couldn't read the old text";
      console.error(`case-history extract failed for ${client.name}`, err);
    }
  }

  // Whatever they already told us on the intake form seeds its sections too.
  const snapshot = resolveIntakeSnapshot(client.intakeAnswers);
  if (snapshot) {
    history = seedFromIntake(history, snapshot, client.intakeSubmittedAt ?? client.createdAt);
  }

  await prisma.client.update({
    where: { id },
    data: { caseHistory: history as unknown as Prisma.InputJsonValue },
  });

  await renderCaseHistoryDoc(id, docId, original);
  await prisma.client.update({ where: { id }, data: { caseHistoryFormattedAt: new Date() } });

  return NextResponse.json({
    ok: true,
    docId,
    url: `https://docs.google.com/document/d/${docId}/edit`,
    filled,
    recoveredSessions,
    keptOriginal: !!original,
    readError,
  });
});
