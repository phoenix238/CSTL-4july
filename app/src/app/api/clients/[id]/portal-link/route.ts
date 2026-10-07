import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { getPortalIdentity, portalUrl } from "@/lib/portal";
import { sendEmail } from "@/lib/google/gmail";
import { composeBookingPageEmail } from "@/lib/bookingPageEmail";

/** The client's private page link and payment reference (created on first request). */
export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const settings = await getSettings();
  const { token, paymentRef } = await getPortalIdentity(id);
  return NextResponse.json({ url: portalUrl(settings, token), paymentRef });
});

/**
 * Email the client their page link.
 *
 * This is the message Phoenix promises at the end of a session — "I'll send you
 * a link" — so it leads with what the link is *for* (booking their next session)
 * rather than reading like an account setup email, and carries the bank details
 * and their reference so the whole payment question is answered in one place.
 */
export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const settings = await getSettings();
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) throw new Error("No email address on this client's record yet.");

  const { token, paymentRef } = await getPortalIdentity(id);
  const url = portalUrl(settings, token);
  const { subject, body } = composeBookingPageEmail(settings, { clientName: client.name, link: url, paymentRef });
  await sendEmail(client.email, subject, body, undefined, undefined, {
    links: [{ url, label: "Click here for your booking page" }],
  });
  return NextResponse.json({ url, paymentRef, sentTo: client.email });
});
