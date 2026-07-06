import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";

/** The client's personal intake-form link (creates the token on first request). */
export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const settings = await getSettings();
  const url = intakeUrl(settings, await getOrCreateIntakeToken(id));
  return NextResponse.json({ url });
});
