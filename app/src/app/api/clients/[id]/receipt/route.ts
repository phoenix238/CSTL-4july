import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { sendClientReceipt } from "@/lib/receipt";

/** Email this client their receipt — the same one they can request themselves. */
export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await sendClientReceipt(id));
});
