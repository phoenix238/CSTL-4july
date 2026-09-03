import { NextResponse } from "next/server";
import { buildSessionIcs } from "@/lib/calendarLinks";

/**
 * A downloadable .ics for a made-up session, driven entirely by query params —
 * used only by the Settings "send test email" panel so its preview of a real
 * booking confirmation has a genuinely working Apple Calendar / Outlook link,
 * the same as a client's email does. No DB lookup, nothing client-specific:
 * this just echoes back a calendar file for whatever start/location it's given.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const startISO = url.searchParams.get("start");
  const location = url.searchParams.get("location") ?? undefined;
  const start = startISO ? new Date(startISO) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid or missing start" }, { status: 400 });
  }

  const ics = buildSessionIcs({ uid: "sample", start, location });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sample-session.ics"',
      "Cache-Control": "no-store",
    },
  });
}
