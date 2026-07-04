import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getBusySpans } from "@/lib/google/calendar";
import { londonDayStart } from "@/lib/time";

export const GET = guarded(async (req: Request) => {
  const days = Number(new URL(req.url).searchParams.get("days") ?? "7");
  const start = londonDayStart(0);
  const end = londonDayStart(days);
  const spans = await getBusySpans(start, end);
  return NextResponse.json({ spans });
});
