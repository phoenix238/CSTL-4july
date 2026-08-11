import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { summariseNote } from "@/lib/claude";
import { ensureClientFolderAndDoc } from "@/lib/google/drive";
import { addSessionToDoc } from "@/lib/caseHistory";

export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const raw = text(body.raw);
  const clinic: string = body.clinic ?? "waterloo";
  // The other three things recorded each session — all optional, so a quick
  // note is still just the note.
  const between = text(body.between);
  const reflections = text(body.reflections);
  const nextSession = text(body.nextSession);

  if (!raw) return NextResponse.json({ error: "Note is empty" }, { status: 400 });

  const bullets = body.bullets?.length ? body.bullets : await summariseNote(raw);
  const date = new Date();

  const note = await prisma.sessionNote.create({
    data: { clientId: id, date, clinic, raw, bullets, between, reflections, nextSession },
  });

  // Into the top of the Doc's session log, not the bottom of the Doc.
  const { docId } = await ensureClientFolderAndDoc(id);
  await addSessionToDoc(docId, { date, clinic, bullets, raw, between, reflections, nextSession });

  return NextResponse.json(note);
});
