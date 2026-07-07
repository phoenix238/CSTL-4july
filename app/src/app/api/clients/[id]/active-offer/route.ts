import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Does this client have times offered and awaiting their reply? Powers the enquiry-page prompt. */
export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const offer = await prisma.enquiry.findFirst({
    where: { clientId: id, status: "offered" },
    orderBy: { createdAt: "desc" },
    select: { id: true, offeredTimes: true },
  });
  return NextResponse.json({
    enquiry:
      offer && offer.offeredTimes.length
        ? { id: offer.id, offeredTimes: offer.offeredTimes.map((t) => t.toISOString()) }
        : null,
  });
});
