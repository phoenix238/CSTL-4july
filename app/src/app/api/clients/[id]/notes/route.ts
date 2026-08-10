import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { summariseNote } from "@/lib/claude";
import { ensureClientFolderAndDoc } from "@/lib/google/drive";
import { addSessionToDoc } from "@/lib/caseHistory";

export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { raw, bullets: providedBullets, clinic } = await req.json();
  if (!raw?.trim()) return NextResponse.json({ error: "Note is empty" }, { status: 400 });

  const bullets = providedBullets?.length ? providedBullets : await summariseNote(raw);
  const date = new Date();

  const note = await prisma.sessionNote.create({
    data: { clientId: id, date, clinic, raw, bullets },
  });

  // Into the top of the Doc's session log, not the bottom of the Doc.
  const { docId } = await ensureClientFolderAndDoc(id);
  await addSessionToDoc(docId, { date, clinic, bullets, raw });

  return NextResponse.json(note);
});
