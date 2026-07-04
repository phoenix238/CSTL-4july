import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";

export const POST = guarded(async (req: Request) => {
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Paste a message first" }, { status: 400 });

  const analysis = await analyseEnquiry(text);
  const enquiry = await prisma.enquiry.create({
    data: { text, name: analysis.name || "", status: "waiting" },
  });
  return NextResponse.json({ enquiry, analysis });
});
