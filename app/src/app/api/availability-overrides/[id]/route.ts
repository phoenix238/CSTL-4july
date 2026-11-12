import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { overrideAppliesOn } from "@/lib/booking/availability";
import { londonDateKey, londonWeekdayIndex } from "@/lib/time";
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

  const override = await prisma.availabilityOverride.update({ where: { id, deletedAt: null }, data });
  await syncAvailabilityAfterChange();
  return NextResponse.json({ override });
});

function occurrenceDate(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(day.getTime()) && londonDateKey(day) === date ? { date, day } : null;
}

export const DELETE = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const occurrence = occurrenceDate(req);
  if (new URL(req.url).searchParams.has("date") && !occurrence) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  if (occurrence) {
    const row = await prisma.availabilityOverride.findUnique({ where: { id, deletedAt: null } });
    if (!row?.repeatWeekly || !overrideAppliesOn({ date: row.date, repeatWeekly: true }, occurrence.date, londonWeekdayIndex(occurrence.day))) {
      return NextResponse.json({ error: "No repeating window on this date" }, { status: 404 });
    }
    await prisma.availabilityOverride.updateMany({
      where: { id, deletedAt: null, repeatWeekly: true, NOT: { excludedDates: { has: occurrence.date } } },
      data: { excludedDates: { push: occurrence.date } },
    });
  } else {
    await prisma.availabilityOverride.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  }
  await syncAvailabilityAfterChange();
  return NextResponse.json({ ok: true });
});

export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const occurrence = occurrenceDate(req);
  if (new URL(req.url).searchParams.has("date") && !occurrence) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (occurrence) {
    await prisma.$executeRaw`
      UPDATE "AvailabilityOverride"
      SET "excludedDates" = array_remove("excludedDates", ${occurrence.date})
      WHERE "id" = ${id} AND "deletedAt" IS NULL AND "repeatWeekly" = TRUE
    `;
  } else {
    await prisma.availabilityOverride.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } });
  }
  await syncAvailabilityAfterChange();
  return NextResponse.json({ ok: true });
});
