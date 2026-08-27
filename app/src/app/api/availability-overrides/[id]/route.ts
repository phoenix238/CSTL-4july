import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { syncAvailabilityAfterChange } from "@/lib/google/availabilityHooks";

export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { kind, startMin, endMin, note, repeatWeekly, exactStart } = await req.json();
  const data: { kind?: string; startMin?: number; endMin?: number; note?: string; repeatWeekly?: boolean; exactStart?: boolean } = {};

  if (kind !== undefined) {
    if (kind !== "open" && kind !== "block") {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    data.kind = kind;
  }
  if (startMin !== undefined || endMin !== undefined) {
    const start = Number(startMin);
    const end = Number(endMin);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1440 || start >= end) {
      return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
    }
    data.startMin = start;
    data.endMin = end;
  }
  if (note !== undefined) data.note = String(note).trim();
  if (repeatWeekly !== undefined) data.repeatWeekly = !!repeatWeekly;
  if (exactStart !== undefined) data.exactStart = !!exactStart;

  const override = await prisma.availabilityOverride.update({ where: { id }, data });
  await syncAvailabilityAfterChange();
  return NextResponse.json({ override });
});

export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await prisma.availabilityOverride.delete({ where: { id } });
  await syncAvailabilityAfterChange();
  return NextResponse.json({ ok: true });
});
