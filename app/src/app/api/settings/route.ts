import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";

/** The editable settings the UI needs (email preview etc.) — no Google secrets. */
export const GET = guarded(async () => {
  const s = await getSettings();
  return NextResponse.json({
    accessNote: s.accessNote,
    emailTemplateWaterloo: s.emailTemplateWaterloo,
    emailTemplateBethnal: s.emailTemplateBethnal,
    paymentDetails: s.paymentDetails,
    intakeFormUrl: s.intakeFormUrl,
  });
});

export const PATCH = guarded(async (req: Request) => {
  const data = await req.json();
  const settings = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  return NextResponse.json(settings);
});
