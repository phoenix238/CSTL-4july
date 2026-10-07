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

  // The summary is a nice-to-have; the note is the record. If Claude can't be
  // reached (an expired or missing API key, an outage), save the note without
  // bullets rather than refusing to save it at all.
  let bullets: string[] = providedBullets?.length ? providedBullets : [];
  let summarySkipped = false;
  if (!bullets.length) {
    try {
      bullets = await summariseNote(raw);
    } catch (err) {
      console.error("Note summary failed — saving the note without one", err);
      summarySkipped = true;
    }
  }
  const date = new Date();

  const note = await prisma.sessionNote.create({
    data: { clientId: id, date, clinic, raw, bullets },
  });

  const { docId } = await ensureClientFolderAndDoc(id);
  await appendNoteToDoc(docId, { date: fmtDate(date), clinic, bullets, raw });

  return NextResponse.json({ ...note, summarySkipped });
});
