import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";
import { findExistingClient } from "@/lib/clients";

/** The inbox — waiting + offered (awaiting the client's reply). */
export const GET = guarded(async () => {
  const enquiries = await prisma.enquiry.findMany({
    where: { status: { in: ["waiting", "offered"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, via: true, name: true, text: true, status: true, clientId: true, offeredTimes: true, createdAt: true },
  });
  return NextResponse.json({ enquiries });
});

export const POST = guarded(async (req: Request) => {
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Paste a message first" }, { status: 400 });

  const analysis = await analyseEnquiry(text);
  const enquiry = await prisma.enquiry.create({
    data: { text, name: analysis.name || "", via: analysis.via, status: "waiting" },
  });
  const existing = analysis.name
    ? await findExistingClient(analysis.name, analysis.email || undefined, analysis.phone || undefined)
    : null;
  return NextResponse.json({
    enquiry,
    analysis,
    match: existing
      ? {
          id: existing.id,
          name: existing.name,
          clinic: existing.clinic,
          email: existing.email,
          welcomeSent: existing.welcomeSent,
        }
      : null,
  });
});
