import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { summariseNote } from "@/lib/claude";
import { appendNoteToDoc, ensureClientFolderAndDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { raw, bullets: providedBullets, clinic } = await req.json();
  if (!raw?.trim()) return NextResponse.json({ error: "Note is empty" }, { status: 400 });

  const bullets = providedBullets?.length ? providedBullets : await summariseNote(raw);
  const date = new Date();

  const note = await prisma.sessionNote.create({
    data: { clientId: id, date, clinic, raw, bullets },
  });

  const { docId } = await ensureClientFolderAndDoc(id);
  await appendNoteToDoc(docId, { date: fmtDate(date), clinic, bullets, raw });

  return NextResponse.json(note);
});
