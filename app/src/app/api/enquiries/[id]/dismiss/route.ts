import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await prisma.enquiry.update({ where: { id }, data: { status: "dismissed" } });
  return NextResponse.json({ ok: true });
});
