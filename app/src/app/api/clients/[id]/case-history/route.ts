import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ensureClientFolderAndDoc } from "@/lib/google/drive";
import { cleanEntries, refreshCaseHistoryDoc, resolveCaseHistory } from "@/lib/caseHistory";

export const maxDuration = 60;

/**
 * Write the case history from the app — taking it in the room, or adding to it
 * afterwards. The whole set of boxes comes in at once, so clearing one is a
 * saved change like any other.
 *
 * The Doc is re-rendered from the saved record, which is what keeps the two in
 * step. Anything the Doc held that the layout doesn't account for is carried
 * through to ORIGINAL RECORD rather than lost.
 */
export const PUT = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { entries } = (await req.json()) as { entries?: Record<string, unknown> };
  if (!entries || typeof entries !== "object") {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id }, select: { caseHistory: true } });
  const history = { ...resolveCaseHistory(client.caseHistory), entries: cleanEntries(entries) };

  await prisma.client.update({
    where: { id },
    data: { caseHistory: history as unknown as Prisma.InputJsonValue },
  });

  // Saving the record is the point; a Drive hiccup shouldn't lose the writing.
  let docError = "";
  try {
    const { docId } = await ensureClientFolderAndDoc(id);
    await refreshCaseHistoryDoc(id, docId);
  } catch (err) {
    docError = err instanceof Error ? err.message : "couldn't update the Doc";
    console.error(`case-history Doc refresh failed for client ${id}`, err);
  }

  return NextResponse.json({ ok: true, entries: history.entries, docError });
});
