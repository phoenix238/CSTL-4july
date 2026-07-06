import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { listDriveFiles } from "@/lib/google/drive";
import { parseDriveFolderLink } from "@/lib/driveLink";

/** List the files in a Drive folder. ?folderId= accepts an id or a pasted link. */
export const GET = guarded(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("folderId") ?? "";
  const folderId = parseDriveFolderLink(raw);
  if (!folderId) {
    return NextResponse.json({ error: "That doesn't look like a Drive folder link" }, { status: 400 });
  }
  const files = await listDriveFiles(folderId);
  return NextResponse.json({ files, folderId });
});
