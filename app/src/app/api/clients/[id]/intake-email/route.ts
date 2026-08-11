import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { googleErrorMessage, googleFixFor } from "@/lib/google/health";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";
import { resolveClientCopy, applyCopy } from "@/lib/clientCopy";


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
    // What Google actually said, plus the specific fix for it. "Reconnect
    // Google" used to be the answer to every failure here, including the ones
    // reconnecting cannot fix — so it was possible to reconnect, see a green
    // tick, and get the identical error on the next tap with nothing to go on.
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
  await prisma.client.update({ where: { id }, data: { intakeEmailSentAt: sentAt } });
  return NextResponse.json({ ok: true, sentAt });
});
