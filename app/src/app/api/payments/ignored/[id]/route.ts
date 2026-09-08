import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Stop auto-setting-aside payments from a remembered sender. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await prisma.ignoredPayer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
