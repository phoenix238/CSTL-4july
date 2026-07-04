import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";

export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  if (!client.email) return NextResponse.json({ error: "No email address on record" }, { status: 400 });

  const settings = await getSettings();
  await sendEmail(
    client.email,
    "Your intake form — Phoenix Tanner CSTL",
    `Hi ${client.name},\n\nJust a reminder to fill in the short intake form when you get a moment — the link is below.\n\n${settings.intakeFormUrl}\n\nSee you soon,\nPhoenix`,
  );
  return NextResponse.json({ ok: true });
});
