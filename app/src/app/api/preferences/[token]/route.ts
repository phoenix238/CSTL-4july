import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { upsertMarketingRow } from "@/lib/google/sheets";

// NOT guarded — the client sets their own marketing preference via their token.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const client = await prisma.client.findFirst({ where: { intakeToken: token } });
    if (!client) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

    const { marketing } = (await req.json()) as { marketing?: boolean };
    const updated = await prisma.client.update({
      where: { id: client.id },
      data: { marketing: !!marketing },
    });
    await upsertMarketingRow(updated.name, updated.email, updated.marketing);
    return NextResponse.json({ ok: true, marketing: updated.marketing });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
