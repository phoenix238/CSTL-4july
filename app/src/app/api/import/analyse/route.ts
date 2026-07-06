import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { extractTextFromFile } from "@/lib/extractText";
import { analyseFileText, type ImportProposal, type UnreadableFile } from "@/lib/importAnalyse";

export const maxDuration = 60;

export const POST = guarded(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  const proposals: ImportProposal[] = [];
  const unreadable: UnreadableFile[] = [];

  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const content = await extractTextFromFile(file.name, buf);
    if (!content?.trim()) {
      unreadable.push({ name: file.name });
      continue;
    }
    proposals.push(...(await analyseFileText(file.name, content)));
  }

  return NextResponse.json({ proposals, unreadable });
});
