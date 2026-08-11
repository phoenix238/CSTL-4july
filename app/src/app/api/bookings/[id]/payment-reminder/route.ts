import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { sendPaymentReminder } from "@/lib/payments/unpaid";

/** Send one gentle payment reminder to the client for this session. */
export const POST = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { sentTo } = await sendPaymentReminder(id);
  return NextResponse.json({ ok: true, sentTo });
});
