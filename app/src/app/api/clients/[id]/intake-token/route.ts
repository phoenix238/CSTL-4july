import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getOrCreateIntakeToken } from "@/lib/intake";

/** The client's private intake token, for filling the form in with them in the room. */
export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const token = await getOrCreateIntakeToken(id);
  return NextResponse.json({ token });
});
