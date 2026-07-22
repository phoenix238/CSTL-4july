import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { extractSessionMoments } from "@/lib/claude";

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];

// Live surfacing during a session. Ephemeral: analyses the latest chunk of
// transcript against what's already been captured and returns any NEW highlight
// moments (the client's words) and questions (the practitioner's). Nothing is
// persisted here — the finished set is saved via /api/clients/[id]/session.
export const POST = guarded(async (req: Request) => {
  const { recent, highlights, questions } = await req.json();
  const out = await extractSessionMoments(
    typeof recent === "string" ? recent : "",
    strings(highlights),
    strings(questions),
  );
  return NextResponse.json(out);
});
