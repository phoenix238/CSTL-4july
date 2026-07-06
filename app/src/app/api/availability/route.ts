import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getBusySpans } from "@/lib/google/calendar";
import { londonDayStart } from "@/lib/time";

export const GET = guarded(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const days = Math.min(Number(params.get("days") ?? "7") || 7, 42);
  const startParam = params.get("start");
  const from = startParam ? new Date(startParam) : new Date();
  if (Number.isNaN(from.getTime())) throw new Error("Invalid start date");
  const start = londonDayStart(0, from);
  const end = londonDayStart(days, from);
  const spans = await getBusySpans(start, end);
  return NextResponse.json({ spans });
});
