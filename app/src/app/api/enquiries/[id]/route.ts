import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";

export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id } });
  const analysis = await analyseEnquiry(enquiry.text);
  return NextResponse.json({ enquiry, analysis });
});
