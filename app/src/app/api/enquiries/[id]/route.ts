import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";
import { findExistingClient } from "@/lib/clients";

/** Hard-delete an enquiry that never went anywhere (vs. dismiss, which just hides it). */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await prisma.enquiry.delete({ where: { id } });
  revalidateTag("shell");
  return NextResponse.json({ ok: true });
});

export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id } });

  // Shadow enquiries (no pasted text — created straight from a picked client)
  // have nothing for Claude to read; synthesize the analysis from the client instead.
  const existingForShadow = !enquiry.text.trim() && enquiry.clientId
    ? await prisma.client.findUnique({ where: { id: enquiry.clientId } })
    : null;
  const analysis = existingForShadow
    ? {
        name: existingForShadow.name,
        phone: existingForShadow.phone,
        email: existingForShadow.email,
        via: "PASTED" as const,
        clinicSuggestion: null,
        clinicReason: "",
        requestedWhen: "",
      }
    : await analyseEnquiry(enquiry.text);

  // Prefer the client this enquiry was already saved as; otherwise dedupe-match.
  const existing = existingForShadow
    ? existingForShadow
    : enquiry.clientId
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
