import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { listDriveFolders } from "@/lib/google/drive";

/** Browse/search the user's Drive folders. ?parent=<id> or ?q=<name search> */
export const GET = guarded(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const parent = params.get("parent") ?? "root";
  const q = params.get("q") ?? undefined;
  const folders = await listDriveFolders(parent, q);
  return NextResponse.json({ folders });
});
