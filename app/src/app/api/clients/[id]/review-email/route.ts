import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { googleErrorMessage, googleFixFor } from "@/lib/google/health";
import { composeReviewEmail } from "@/lib/booking/review";
import type { Clinic } from "@/lib/booking/rules";
import { getOrCreateIntakeToken, preferencesUrl } from "@/lib/intake";

/** Send the post-session review + marketing opt-in email. */
export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) return NextResponse.json({ error: "No email address on record" }, { status: 400 });

  const settings = await getSettings();
  const optInLink = preferencesUrl(settings, await getOrCreateIntakeToken(client.id));
  const { subject, body } = composeReviewEmail(client.name, client.clinic as Clinic, settings, optInLink);
  const mapsUrl = (client.clinic as Clinic) === "waterloo" ? settings.mapsReviewUrlWaterloo : settings.mapsReviewUrlBethnal;
  try {
    await sendEmail(client.email, subject, body, undefined, undefined, {
      links: [
        { url: optInLink, label: "Manage your email preferences" },
        ...(mapsUrl ? [{ url: mapsUrl, label: "Leave a Google review" }] : []),
      ],
    });
  } catch (err) {
    // Google's own words plus the fix that matches them — see the intake-email
    // route for why a blanket "reconnect Google" was worse than useless here.
    const message = googleErrorMessage(err);
    return NextResponse.json(
      {
        error: `Couldn't send it — ${message}. Settings › Behind the scenes › Google has the full details.`,
        fix: googleFixFor(message),
      },
      { status: 502 },
    );
  }
  const sentAt = new Date();
  await prisma.client.update({ where: { id }, data: { reviewEmailSentAt: sentAt } });
  return NextResponse.json({ ok: true, sentAt });
});
