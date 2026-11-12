import { z } from "zod";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getSettings, prisma } from "@/lib/db";
import { extendedIntakeFields, readIntakeAnswers } from "@/lib/intakeProfile";
import { resolveIntakeQuestions } from "@/lib/intakeQuestions";

export const PUT = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const notes = z.record(z.string().max(20000)).safeParse(body?.notes);
  const consent = body?.consent;
  if (!notes.success || (consent !== undefined && typeof consent !== "boolean")) {
    return NextResponse.json({ error: "Enter valid intake notes and consent." }, { status: 400 });
  }

  const [client, settings] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id }, select: { intakeAnswers: true, firstSessionIntake: true } }),
    getSettings(),
  ]);
  const fields = extendedIntakeFields(resolveIntakeQuestions(settings.intakeQuestions), readIntakeAnswers(client.intakeAnswers));
  const allowed = new Set(fields.map(({ key }) => key));
  const previous = client.firstSessionIntake;
  const existing = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
  if (Object.keys(notes.data).some((key) => !allowed.has(key) && !Object.hasOwn(existing, key))) {
    return NextResponse.json({ error: "Check the intake fields and their length." }, { status: 400 });
  }
  await prisma.client.update({
    where: { id },
    data: {
      firstSessionIntake: { ...existing, ...notes.data },
      ...(typeof consent === "boolean" ? { consentGiven: consent, intakeDone: true } : {}),
    },
  });
  return NextResponse.json({ ok: true });
});
