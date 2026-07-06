import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getDriveFileText } from "@/lib/google/drive";
import { analyseFileText, type ImportProposal, type UnreadableFile } from "@/lib/importAnalyse";

export const maxDuration = 60;

/** Analyse selected Drive files. Body: { files: [{id, name, mimeType}] } */
export const POST = guarded(async (req: Request) => {
  const { files } = (await req.json()) as {
    files: Array<{ id: string; name: string; mimeType: string }>;
  };
  if (!files?.length) return NextResponse.json({ error: "Pick some files first" }, { status: 400 });

  const proposals: ImportProposal[] = [];
  const unreadable: UnreadableFile[] = [];

  for (const file of files) {
    const content = await getDriveFileText(file.id, file.name, file.mimeType);
    if (!content?.trim()) {
      unreadable.push({ name: file.name, driveFileId: file.id });
      continue;
    }
    proposals.push(...(await analyseFileText(file.name, content, file.id)));
  }

  return NextResponse.json({ proposals, unreadable });
});
