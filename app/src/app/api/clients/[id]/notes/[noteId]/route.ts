import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Fix a dictation/summary mistake on an already-saved note (cached copy only — the Doc keeps its original history). */
export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string; noteId: string }> }) => {
  const { id, noteId } = await ctx.params;
  const { raw, bullets } = (await req.json()) as { raw?: string; bullets?: string[] };

  const existing = await prisma.sessionNote.findFirst({ where: { id: noteId, clientId: id } });
  if (!existing) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const data: { raw?: string; bullets?: string[] } = {};
  if (typeof raw === "string") data.raw = raw;
  if (Array.isArray(bullets)) data.bullets = bullets.filter((b) => b.trim().length > 0);

  const note = await prisma.sessionNote.update({ where: { id: noteId }, data });
  return NextResponse.json(note);
});
