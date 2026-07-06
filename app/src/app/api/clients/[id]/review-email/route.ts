import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { composeReviewEmail } from "@/lib/booking/review";
import { getOrCreateIntakeToken, preferencesUrl } from "@/lib/intake";

/** Send the post-session review + marketing opt-in email. */
export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) return NextResponse.json({ error: "No email address on record" }, { status: 400 });

  const settings = await getSettings();
  const optInLink = preferencesUrl(settings, await getOrCreateIntakeToken(client.id));
  const { subject, body } = composeReviewEmail(client.name, settings, optInLink);
  await sendEmail(client.email, subject, body);
  return NextResponse.json({ ok: true });
});
