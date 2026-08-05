import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { listDriveDocs } from "@/lib/google/drive";

/** Search your Google Docs by name. ?q=<name search> — no q = recently touched. */
export const GET = guarded(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  const docs = await listDriveDocs(q);
  return NextResponse.json({ docs });
});
