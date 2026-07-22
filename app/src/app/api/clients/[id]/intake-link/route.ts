import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";

/** The client's personal intake-form link (creates the token on first request). */
export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const settings = await getSettings();
  const url = intakeUrl(settings, await getOrCreateIntakeToken(id));
  // This route is only hit when Phoenix shares the link (copy button / WhatsApp
  // fallback) — record it so the profile reads "shared", not "not sent yet",
  // even when it goes out by copy rather than email.
  await prisma.client.update({ where: { id }, data: { intakeEmailSentAt: new Date() } });
  return NextResponse.json({ url });
});
