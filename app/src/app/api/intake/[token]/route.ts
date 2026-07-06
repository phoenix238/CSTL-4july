import { NextResponse } from "next/server";
import { prisma, getSettings } from "@/lib/db";
import { updateClientDetails } from "@/lib/clients";
import { ensureClientFolderAndDoc, appendTextToDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";
import { COLUMN_KEYS, resolveIntakeQuestions } from "@/lib/intakeQuestions";

// NOT guarded — the client fills this in without logging in. The token is the auth.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json({ error: "Missing link" }, { status: 400 });

    const client = await prisma.client.findFirst({ where: { intakeToken: token } });
    if (!client) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

    const { name, answers } = (await req.json()) as { name?: string; answers?: Record<string, string> };
    const a = answers ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    const settings = await getSettings();
    const questions = resolveIntakeQuestions(settings.intakeQuestions).filter((q) => q.enabled);

    // Standard answers update the record; everything shows in the Doc.
    const columnUpdate: Record<string, string | boolean> = { name: str(name) || client.name, intakeDone: true };
    for (const q of questions) {
      if (COLUMN_KEYS.has(q.key) && a[q.key] !== undefined) columnUpdate[q.key] = str(a[q.key]);
    }
    await updateClientDetails(client.id, columnUpdate);

    const { docId } = await ensureClientFolderAndDoc(client.id);
    const lines = [
      `\n══════════════════════════`,
      `INTAKE / CASE HISTORY — submitted ${fmtDate(new Date())}`,
      `══════════════════════════`,
      `Name: ${str(name) || client.name}`,
      ...questions.map((q) => `${q.label}: ${str(a[q.key]) || "—"}`),
      ``,
    ];
    await appendTextToDoc(docId, lines.join("\n"));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
