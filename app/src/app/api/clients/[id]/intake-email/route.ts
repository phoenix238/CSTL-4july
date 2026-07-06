import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";

export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) return NextResponse.json({ error: "No email address on record" }, { status: 400 });

  const settings = await getSettings();
  const link = intakeUrl(settings, await getOrCreateIntakeToken(client.id));
  await sendEmail(
    client.email,
    "Your intake form — Phoenix Tanner CSTL",
    `Hi ${client.name},\n\nWhen you get a moment, please fill in your short intake form — it takes a couple of minutes and goes straight into your confidential record:\n\n${link}\n\nSee you soon,\nPhoenix`,
  );
  return NextResponse.json({ ok: true });
});
