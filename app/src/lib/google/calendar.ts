import { prisma } from "@/lib/db";
import {
  EVENT_REMINDERS,
  planBookingEvents,
  type Clinic,
} from "@/lib/booking/rules";
import { calendarId, getCalendarApi } from "./client";

const TZ = "Europe/London";

/**
 * Create the calendar events for a booking (per Phoenix's clinic rules) and
 * record their ids on the Booking row. The client is added as an attendee on
 * the personal event so Google sends them the calendar invite.
 */
export async function createBookingEvents(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { client: true },
  });
  const calendar = await getCalendarApi();
  const plan = planBookingEvents(booking.clinic as Clinic, booking.client.name, booking.startsAt);

  let personalEventId = "";
  let secondaryEventId = "";
  for (const ev of plan) {
    const calId = await calendarId(ev.calendar);
    const res = await calendar.events.insert({
      calendarId: calId,
      sendUpdates: ev.inviteClient && booking.client.email ? "all" : "none",
      requestBody: {
        summary: ev.summary,
        start: { dateTime: ev.start.toISOString(), timeZone: TZ },
        end: { dateTime: ev.end.toISOString(), timeZone: TZ },
        reminders: EVENT_REMINDERS,
        attendees:
          ev.inviteClient && booking.client.email
            ? [{ email: booking.client.email, displayName: booking.client.name }]
            : undefined,
      },
    });
    if (ev.calendar === "personal") personalEventId = res.data.id!;
    else secondaryEventId = res.data.id!;
  }
  await prisma.booking.update({
    where: { id: bookingId },
    data: { personalEventId, secondaryEventId },
  });
  return { personalEventId, secondaryEventId };
}

/** Cancel a booking: delete both Google events and mark the row cancelled. */
export async function cancelBookingEvents(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const calendar = await getCalendarApi();
  const clinic = booking.clinic as Clinic;
  const targets: Array<[string, string]> = [];
  if (booking.personalEventId) targets.push([await calendarId("personal"), booking.personalEventId]);
  if (booking.secondaryEventId) {
    targets.push([await calendarId(clinic === "waterloo" ? "room" : "chalkFarm"), booking.secondaryEventId]);
  }
  for (const [calId, eventId] of targets) {
    try {
      await calendar.events.delete({ calendarId: calId, eventId, sendUpdates: "all" });
    } catch (err: unknown) {
      // Already gone on Google's side — fine, we're freeing the slot either way.
      const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
      if (status !== 404 && status !== 410) throw err;
    }
  }
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "cancelled" } });
}

export interface BusySpan {
  start: Date;
  end: Date;
  /** Human explanation of what's blocking the slot. */
  title: string;
  /** true when this is one of our own known bookings (vs. generic Google busy time) */
  known: boolean;
}

/**
 * Everything blocking time in a window: our own bookings (named) plus
 * free/busy from all connected Google calendars ("Busy — synced from Google
 * Calendar"). Used by the availability grid and the week view.
 */
export async function getBusySpans(windowStart: Date, windowEnd: Date): Promise<BusySpan[]> {
  const bookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: new Date(windowStart.getTime() - 2 * 3600_000), lt: windowEnd } },
    include: { client: true },
  });
  const known: BusySpan[] = bookings.map((b) => {
    const clinic = b.clinic as Clinic;
    const start = clinic === "bethnal" ? new Date(b.startsAt.getTime() - 30 * 60_000) : b.startsAt;
    const end = new Date(start.getTime() + (clinic === "bethnal" ? 120 : 60) * 60_000);
    return {
      start,
      end,
      title:
        clinic === "waterloo"
          ? `${b.client.name} — Waterloo`
          : `Phoenix — Chalk Farm (${b.client.name})`,
      known: true,
    };
  });

  const calendar = await getCalendarApi();
  const ids = [await calendarId("personal")];
  // Room/Chalk Farm calendars are optional until configured in Settings.
  for (const key of ["room", "chalkFarm"] as const) {
    try {
      ids.push(await calendarId(key));
    } catch {
      /* not configured yet */
    }
  }
  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      timeZone: TZ,
      items: ids.map((id) => ({ id })),
    },
  });
  const google: BusySpan[] = [];
  for (const cal of Object.values(fb.data.calendars ?? {})) {
    for (const span of cal.busy ?? []) {
      if (!span.start || !span.end) continue;
      const start = new Date(span.start);
      const end = new Date(span.end);
      // Skip spans that are (or overlap) our own known bookings — those are already named.
      const isOwn = known.some((k) => start < k.end && end > k.start);
      if (!isOwn) {
        google.push({ start, end, title: "Busy — synced from Google Calendar", known: false });
      }
    }
  }
  return [...known, ...google].sort((a, b) => a.start.getTime() - b.start.getTime());
}
