import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { isGoogleAuthError } from "@/lib/google/client";
import { composeReviewEmail } from "@/lib/booking/review";
import type { Clinic } from "@/lib/booking/rules";
import { getOrCreateIntakeToken, preferencesUrl } from "@/lib/intake";

const RECONNECT_MSG =
  "Google needs reconnecting — open Settings › Behind the scenes and tap “Reconnect Google”, then try again.";

/** Send the post-session review + marketing opt-in email. */
export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) return NextResponse.json({ error: "No email address on record" }, { status: 400 });

  const settings = await getSettings();
  const optInLink = preferencesUrl(settings, await getOrCreateIntakeToken(client.id));
  const { subject, body } = composeReviewEmail(client.name, client.clinic as Clinic, settings, optInLink);
  try {
    await sendEmail(client.email, subject, body);
  } catch (err) {
    if (isGoogleAuthError(err)) return NextResponse.json({ error: RECONNECT_MSG }, { status: 403 });
    throw err;
  }
  const sentAt = new Date();
  await prisma.client.update({ where: { id }, data: { reviewEmailSentAt: sentAt } });
  return NextResponse.json({ ok: true, sentAt });
});
