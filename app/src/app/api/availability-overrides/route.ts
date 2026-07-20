import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = guarded(async () => {
  const overrides = await prisma.availabilityOverride.findMany({ orderBy: { date: "asc" } });
  return NextResponse.json({ overrides });
});

export const POST = guarded(async (req: Request) => {
  const { clinic, date, kind, startMin, endMin, note } = await req.json();
  if (clinic !== "waterloo" && clinic !== "bethnal") {
    return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
  }
  if (kind !== "open" && kind !== "block") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  const start = Number(startMin);
  const end = Number(endMin);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1440 || start >= end) {
    return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
  }
  const override = await prisma.availabilityOverride.create({
    data: { clinic, date, kind, startMin: start, endMin: end, note: note?.trim() || "" },
  });
  return NextResponse.json({ override });
});
