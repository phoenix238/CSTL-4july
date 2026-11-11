import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = guarded(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const candidateId = new URL(req.url).searchParams.get("candidate");
  if (!candidateId || candidateId === id) {
    return NextResponse.json({ error: "Choose another client profile to compare." }, { status: 400 });
  }
  const records = await prisma.client.findMany({
    where: { id: { in: [id, candidateId] } },
    select: {
      id: true, name: true, email: true, phone: true, dob: true, intakeDone: true,
      docId: true, historyDocIds: true, paymentRef: true,
      alternateEmails: { select: { email: true }, orderBy: { email: "asc" } },
      _count: { select: { bookings: true, notes: true, recordings: true, enquiries: true } },
    },
  });
  const current = records.find((record) => record.id === id);
  const candidate = records.find((record) => record.id === candidateId);
  if (!current || !candidate) {
    return NextResponse.json({ error: "One of the profiles is unavailable." }, { status: 404 });
  }
  const describe = ({ docId, historyDocIds, ...record }: typeof current) => ({
    ...record,
    documents: new Set([docId, ...historyDocIds].filter(Boolean)).size,
  });
  return NextResponse.json({ current: describe(current), candidate: describe(candidate) }, {
    headers: { "Cache-Control": "no-store" },
  });
});
