import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { summariseReflection } from "@/lib/claude";

/** Shared by both the per-client and standalone reflection composers — neither writes here. */
export const POST = guarded(async (req: Request) => {
  const { raw } = await req.json();
  if (!raw?.trim()) return NextResponse.json({ error: "Nothing to summarise" }, { status: 400 });
  const summary = await summariseReflection(raw);
  return NextResponse.json({ summary });
});
