import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { FIRST_SESSION_FIELDS } from "@/lib/intakeProfile";

export const PUT = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body: unknown = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Enter valid first-session notes." }, { status: 400 });
  }
  const entries = Object.entries(body);
  if (entries.some(([key, value]) =>
    !Object.hasOwn(FIRST_SESSION_FIELDS, key) || typeof value !== "string" || value.length > 20000
  )) {
    return NextResponse.json({ error: "Check the first-session fields and their length." }, { status: 400 });
  }
  await prisma.client.update({ where: { id }, data: { firstSessionIntake: Object.fromEntries(entries) } });
  return NextResponse.json({ ok: true });
});
