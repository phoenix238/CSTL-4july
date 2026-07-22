import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { isGoogleAuthError } from "@/lib/google/client";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";
import { resolveClientCopy, applyCopy } from "@/lib/clientCopy";

const RECONNECT_MSG =
  "Google needs reconnecting — open Settings › Behind the scenes and tap “Reconnect Google”, then try again.";

export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) return NextResponse.json({ error: "No email address on record" }, { status: 400 });

  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy);
  const link = intakeUrl(settings, await getOrCreateIntakeToken(client.id));
  try {
    await sendEmail(
      client.email,
      copy.intakeEmailSubject,
      applyCopy(copy.intakeEmailBody, { name: client.name, link }),
    );
  } catch (err) {
    if (isGoogleAuthError(err)) return NextResponse.json({ error: RECONNECT_MSG }, { status: 403 });
    throw err;
  }
  const sentAt = new Date();
  await prisma.client.update({ where: { id }, data: { intakeEmailSentAt: sentAt } });
  return NextResponse.json({ ok: true, sentAt });
});
