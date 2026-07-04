import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { summariseNote } from "@/lib/claude";

export const POST = guarded(async (req: Request) => {
  const { raw } = await req.json();
  if (!raw?.trim()) return NextResponse.json({ error: "Nothing to summarise" }, { status: 400 });
  const bullets = await summariseNote(raw);
  return NextResponse.json({ bullets });
});
