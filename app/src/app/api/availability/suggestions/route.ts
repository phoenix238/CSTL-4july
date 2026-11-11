import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { loadAvailabilitySuggestions } from "@/lib/booking/slots";
import { londonDayStart } from "@/lib/time";

export const GET = guarded(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const clinic = params.get("clinic");
  const from = new Date(params.get("start") ?? Date.now());
  const days = Number(params.get("days") ?? "7");
  if ((clinic !== "bethnal" && clinic !== "waterloo") || !Number.isFinite(from.getTime()) || !Number.isInteger(days) || days < 1 || days > 7) {
    return NextResponse.json({ error: "Invalid clinic or date range" }, { status: 400 });
  }
  const suggestions = await loadAvailabilitySuggestions(clinic, londonDayStart(0, from), londonDayStart(days, from));
  return NextResponse.json({ suggestions });
});
