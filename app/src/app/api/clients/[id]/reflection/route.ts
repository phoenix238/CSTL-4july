import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { appendReflectionToDoc, ensureReflectionsDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

/**
 * A reflection written from a client's profile. Same store as the Personal tab
 * — this one just arrives with the client already known — so anything written
 * here is readable there afterwards.
 */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Reflection is empty" }, { status: 400 });

  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  const reflection = await prisma.reflection.create({
    data: { text: text.trim(), clientId: client.id, clientName: client.name },
  });

  const docId = await ensureReflectionsDoc();
  await appendReflectionToDoc(docId, {
    date: fmtDate(reflection.date),
    client: client.name,
    text: text.trim(),
  });

  return NextResponse.json({ ok: true });
});
