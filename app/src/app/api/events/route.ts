import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getCalendarApi, calendarId } from "@/lib/google/client";
import { getSpaces } from "@/lib/db";

const TZ = "Europe/London";

/**
 * Which Google calendar a request means: "personal", or "venue:<space id>" for
 * a space's shared venue calendar. Resolved to the real calendar id here, so a
 * request can only ever touch your own calendar or one of your spaces' venues.
 */
async function parseCalendar(v: unknown): Promise<string | null> {
  if (v === "personal") return calendarId("personal");
  if (typeof v === "string" && v.startsWith("venue:")) {
    const space = (await getSpaces()).find((sp) => sp.id === v.slice(6));
    return space?.venueMode !== "none" && space?.venueCalendarId ? space.venueCalendarId : null;
  }
  return null;
}

function parseTimes(startISO: unknown, endISO: unknown) {
  const start = new Date(String(startISO));
  const end = new Date(String(endISO));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { start, end };
}

/** Create a plain calendar event (not a client booking) on one of the calendars. */
export const POST = guarded(async (req: Request) => {
  const { calendar, title, startISO, endISO } = await req.json();
  const cal = await parseCalendar(calendar);
  if (!cal) return NextResponse.json({ error: "Unknown calendar" }, { status: 400 });
  const times = parseTimes(startISO, endISO);
  if (!times) return NextResponse.json({ error: "Invalid times" }, { status: 400 });

  const api = await getCalendarApi();
  const res = await api.events.insert({
    calendarId: cal,
    requestBody: {
      summary: String(title || "").trim() || "(no title)",
      start: { dateTime: times.start.toISOString(), timeZone: TZ },
      end: { dateTime: times.end.toISOString(), timeZone: TZ },
    },
  });
  return NextResponse.json({ id: res.data.id });
});

/** Move / rename an existing Google event in place. */
export const PATCH = guarded(async (req: Request) => {
  const { calendar, eventId, title, startISO, endISO } = await req.json();
  const cal = await parseCalendar(calendar);
  if (!cal) return NextResponse.json({ error: "Unknown calendar" }, { status: 400 });
  if (!eventId) return NextResponse.json({ error: "Missing event" }, { status: 400 });
  const times = parseTimes(startISO, endISO);
  if (!times) return NextResponse.json({ error: "Invalid times" }, { status: 400 });

  const api = await getCalendarApi();
  await api.events.patch({
    calendarId: cal,
    eventId: String(eventId),
    requestBody: {
      ...(typeof title === "string" ? { summary: title.trim() || "(no title)" } : {}),
      start: { dateTime: times.start.toISOString(), timeZone: TZ },
      end: { dateTime: times.end.toISOString(), timeZone: TZ },
    },
  });
  return NextResponse.json({ ok: true });
});

/** Delete a Google event. */
export const DELETE = guarded(async (req: Request) => {
  const { calendar, eventId } = await req.json();
  const cal = await parseCalendar(calendar);
  if (!cal) return NextResponse.json({ error: "Unknown calendar" }, { status: 400 });
  if (!eventId) return NextResponse.json({ error: "Missing event" }, { status: 400 });

  const api = await getCalendarApi();
  try {
    await api.events.delete({ calendarId: cal, eventId: String(eventId) });
  } catch (err: unknown) {
    const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
    if (status !== 404 && status !== 410) throw err;
  }
  return NextResponse.json({ ok: true });
});
