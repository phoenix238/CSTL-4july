import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updateClientDetails } from "@/lib/clients";
import { ensureClientFolderAndDoc, appendTextToDoc } from "@/lib/google/drive";
import { upsertMarketingRow } from "@/lib/google/sheets";
import { fmtDate } from "@/lib/time";

// NOT guarded — the client fills this in without logging in. The token is the auth.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json({ error: "Missing link" }, { status: 400 });

    const client = await prisma.client.findFirst({ where: { intakeToken: token } });
    if (!client) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

    const body = await req.json();
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    const fields = {
      name: str(body.name) || client.name,
      phone: str(body.phone),
      dob: str(body.dob),
      occupation: str(body.occupation),
      doctor: str(body.doctor),
      meds: str(body.meds),
      conditions: str(body.conditions),
      emergency: str(body.emergency),
      referred: str(body.referred),
      marketing: !!body.marketing,
      intakeDone: true,
    };
    const caseHistory = str(body.caseHistory);

    await updateClientDetails(client.id, fields);

    const { docId } = await ensureClientFolderAndDoc(client.id);
    const block =
      `\n══════════════════════════\n` +
      `INTAKE / CASE HISTORY — submitted ${fmtDate(new Date())}\n` +
      `══════════════════════════\n` +
      `Name: ${fields.name}\n` +
      `Date of birth: ${fields.dob || "—"}\n` +
      `Phone: ${fields.phone || "—"}\n` +
      `Occupation: ${fields.occupation || "—"}\n` +
      `GP / doctor: ${fields.doctor || "—"}\n` +
      `Medications: ${fields.meds || "—"}\n` +
      `Health conditions: ${fields.conditions || "—"}\n` +
      `Emergency contact: ${fields.emergency || "—"}\n` +
      `How they heard: ${fields.referred || "—"}\n` +
      `Email marketing consent: ${fields.marketing ? "Yes" : "No"}\n\n` +
      `What brings them to therapy:\n${caseHistory || "—"}\n`;
    await appendTextToDoc(docId, block);

    await upsertMarketingRow(fields.name, client.email, fields.marketing);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
