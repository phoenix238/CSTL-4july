import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { appendReflectionToDoc, ensureReflectionsDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

/** A reflection not tied to any client's session — headed "Personal" in the shared Doc. */
export const POST = guarded(async (req: Request) => {
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Reflection is empty" }, { status: 400 });

  const docId = await ensureReflectionsDoc();
  await appendReflectionToDoc(docId, { date: fmtDate(new Date()), about: "Personal", text });

  return NextResponse.json({ ok: true });
});
