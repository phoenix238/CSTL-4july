import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

/**
 * Edit a reflection in place. Only the copy in the app changes — the Drive Doc
 * keeps what was originally written, which is the honest record of what she
 * thought at the time.
 */
export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { text } = (await req.json()) as { text?: string };
  const body = (text ?? "").trim();
  if (!body) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const reflection = await prisma.reflection.update({ where: { id }, data: { text: body } });
  return NextResponse.json({ ok: true, text: reflection.text });
});

/** Remove it from the app. The Drive Doc still has it. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await prisma.reflection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
