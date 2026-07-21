import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
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

/**
 * Two ways in: a pasted message (analysed by Claude), or a bare `clientId` —
 * a "shadow" enquiry with no text, created so offer/confirm state has
 * somewhere to live for a client picked directly on the grid.
 */
export const POST = guarded(async (req: Request) => {
  const { text, clientId } = await req.json();

  if (!text?.trim()) {
    if (!clientId) return NextResponse.json({ error: "Paste a message first" }, { status: 400 });
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    const enquiry = await prisma.enquiry.create({
      data: { text: "", name: client.name, via: "PASTED", status: "waiting", clientId },
    });
    revalidateTag("shell");
    return NextResponse.json({
      enquiry,
      analysis: null,
      match: {
        id: client.id,
        name: client.name,
        clinic: client.clinic,
        email: client.email,
        welcomeSent: client.welcomeSent,
      },
    });
  }

  const analysis = await analyseEnquiry(text);
  const enquiry = await prisma.enquiry.create({
    data: { text, name: analysis.name || "", via: analysis.via, status: "waiting" },
  });
  revalidateTag("shell");
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
