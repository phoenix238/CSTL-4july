import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { getPortalIdentity, portalUrl } from "@/lib/portal";
import { sendEmail } from "@/lib/google/gmail";

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
  const first = client.name.split(" ")[0] || "there";

  const lines = [
    `Hi ${first},`,
    "",
    "Here's your own page for booking sessions with me:",
    url,
    "",
    "You can book your next session whenever you're ready, move it, or cancel it — no login needed, just keep the link. It's worth bookmarking or saving to your home screen.",
  ];

  if (settings.bankAccountName || settings.bankSortCode || settings.bankAccountNumber) {
    lines.push("", "For bank transfers:");
    if (settings.bankAccountName) lines.push(`  Account name: ${settings.bankAccountName}`);
    if (settings.bankSortCode) lines.push(`  Sort code: ${settings.bankSortCode}`);
    if (settings.bankAccountNumber) lines.push(`  Account number: ${settings.bankAccountNumber}`);
    lines.push(`  Reference: ${paymentRef}`);
    lines.push("", "Please use that reference every time — it's how I match your payment to you.");
  }
  if (settings.bankPaymentNote) lines.push("", settings.bankPaymentNote);

  lines.push("", "Any questions, just reply.", "", "Warm wishes,", "Phoenix");

  await sendEmail(client.email, "Your booking page", lines.join("\n"));
  return NextResponse.json({ url, paymentRef, sentTo: client.email });
});
