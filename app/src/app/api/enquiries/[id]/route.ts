import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";
import { findExistingClient } from "@/lib/clients";

export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id } });
  const analysis = await analyseEnquiry(enquiry.text);

  // Prefer the client this enquiry was already saved as; otherwise dedupe-match.
  const existing = enquiry.clientId
    ? await prisma.client.findUnique({ where: { id: enquiry.clientId } })
    : analysis.name
      ? await findExistingClient(analysis.name, analysis.email || undefined, analysis.phone || undefined)
      : null;

  return NextResponse.json({
    enquiry,
    analysis,
    match: existing
      ? {
          id: existing.id,
          name: existing.name,
          clinic: existing.clinic,
          email: existing.email,
          welcomeSent: existing.welcomeSent,
          saved: existing.id === enquiry.clientId,
        }
      : null,
  });
});
