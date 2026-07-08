import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { appendReflectionToDoc, ensureReflectionsDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Reflection is empty" }, { status: 400 });

  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  const docId = await ensureReflectionsDoc();
  await appendReflectionToDoc(docId, { date: fmtDate(new Date()), client: client.name, text });

  return NextResponse.json({ ok: true });
});
