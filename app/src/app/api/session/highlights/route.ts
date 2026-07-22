import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { extractHighlights } from "@/lib/claude";

// Live highlight-surfacing during a session. Ephemeral: analyses the latest chunk
// of transcript against what's already been surfaced and returns any NEW moments,
// using the Clean Language rubric (it judges the words, not who spoke). Nothing is
// persisted here — the finished set is saved via /api/clients/[id]/session.
export const POST = guarded(async (req: Request) => {
  const { recent, existing } = await req.json();
  const highlights = await extractHighlights(
    typeof recent === "string" ? recent : "",
    Array.isArray(existing) ? existing.filter((e: unknown): e is string => typeof e === "string") : [],
  );
  return NextResponse.json({ highlights });
});
