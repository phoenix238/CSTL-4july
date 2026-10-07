import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { markNoShow, undoNoShow } from "@/lib/noShow";

/** Mark a past session as missed. Body: { email?: boolean } — email the client about it. */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { email } = (await req.json().catch(() => ({}))) as { email?: boolean };
  try {
    return NextResponse.json(await markNoShow(id, { email: !!email }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't mark that" }, { status: 400 });
  }
});

/** Undo a no-show marked by mistake. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await undoNoShow(id);
  return NextResponse.json({ ok: true });
});
