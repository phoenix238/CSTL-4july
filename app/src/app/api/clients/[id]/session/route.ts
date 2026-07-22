import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { summariseSession } from "@/lib/claude";
import { appendFormattedSections, ensureClientFolderAndDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

// Save a live Clean Language session: store the full transcript in the app, and
// append a CURATED block (summary + the client's exact words + your own notes —
// not the raw transcript) to the client's Google Doc.
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p.trim().length > 0) : [];

  const transcript: string = (body.transcript ?? "").trim();
  const pinned: string[] = asStrings(body.pinned);
  const questions: string[] = asStrings(body.questions);
  const myNotes: string = (body.myNotes ?? "").trim();
  const clinic: string = body.clinic ?? "waterloo";

  if (!transcript && !pinned.length && !questions.length && !myNotes) {
    return NextResponse.json({ error: "Nothing recorded yet" }, { status: 400 });
  }

  const bullets = await summariseSession({ transcript, pinned, myNotes });
  const date = new Date();

  const recording = await prisma.sessionRecording.create({
    data: { clientId: id, date, clinic, transcript, pinned, questions, myNotes, bullets },
  });

  const clinicLabel = clinic === "waterloo" ? "Waterloo" : "Bethnal Green";
  const { docId } = await ensureClientFolderAndDoc(id);
  await appendFormattedSections(docId, null, [
    {
      heading: `Session (Clean Language) — ${fmtDate(date)} · ${clinicLabel}`,
      lines: [
        { kind: "bullets", label: "Summary", items: bullets },
        ...(pinned.length ? [{ kind: "bullets" as const, label: "Their words", items: pinned }] : []),
        ...(questions.length ? [{ kind: "bullets" as const, label: "Questions I asked", items: questions }] : []),
        ...(myNotes ? [{ kind: "paragraph" as const, label: "My notes", value: myNotes }] : []),
      ],
    },
  ]);

  return NextResponse.json(recording);
});
