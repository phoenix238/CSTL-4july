import { prisma } from "@/lib/db";
import {
  blockedRange,
  EVENT_REMINDERS,
  mergeBethnalBlocks,
  planBookingEvents,
  type Clinic,
} from "@/lib/booking/rules";
import { calendarId, getCalendarApi } from "./client";

const TZ = "Europe/London";

type CalendarApi = Awaited<ReturnType<typeof getCalendarApi>>;

/** Delete a Google Calendar event, tolerating one that's already gone. */
async function deleteEventQuietly(calendar: CalendarApi, calId: string, eventId: string) {
  try {
    await calendar.events.delete({ calendarId: calId, eventId, sendUpdates: "all" });
  } catch (err: unknown) {
    const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
    if (status !== 404 && status !== 410) throw err;
  }
}

/**
 * Create the calendar events for a booking (per Phoenix's clinic rules) and
 * record their ids on the Booking row. The client is added as an attendee on
 * the personal event so Google sends them the calendar invite.
 *
 * Bethnal Green's Chalk Farm block is handled separately (see
 * syncChalkFarmBlock) — sessions booked close together share one block
 * instead of each getting its own overlapping one.
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
    if (ev.calendar === "chalkFarm") continue; // merged separately below
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
  await prisma.booking.update({ where: { id: bookingId }, data: { personalEventId, secondaryEventId } });

  if (booking.clinic === "bethnal") {
    secondaryEventId = await syncChalkFarmBlock(bookingId, calendar);
  }
  return { personalEventId, secondaryEventId };
}

/**
 * Grow (or create) the Chalk Farm block to cover this booking, merging with
 * any other confirmed Bethnal booking whose own block overlaps it — directly
 * or transitively, so a whole run of back-to-back sessions ends up sharing
 * one block. Updates the Google event and every affected Booking row.
 */
async function syncChalkFarmBlock(bookingId: string, calendar: CalendarApi): Promise<string> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const own = blockedRange("bethnal", booking.startsAt);
  const neighbours = await prisma.booking.findMany({
    where: {
      clinic: "bethnal",
      status: "confirmed",
      id: { not: bookingId },
      startsAt: { gte: new Date(booking.startsAt.getTime() - 86_400_000), lte: new Date(booking.startsAt.getTime() + 86_400_000) },
    },
  });

  const groups = mergeBethnalBlocks([
    { id: bookingId, ...own },
    ...neighbours.map((b) => ({ id: b.id, ...blockedRange("bethnal", b.startsAt) })),
  ]);
  const group = groups.find((g) => g.ids.includes(bookingId))!;
  const members = neighbours.filter((b) => group.ids.includes(b.id));

  const calId = await calendarId("chalkFarm");
  const existingIds = [...new Set(members.map((b) => b.secondaryEventId).filter(Boolean))];
  let eventId = existingIds[0] ?? "";
  for (const stale of existingIds.slice(1)) {
    await deleteEventQuietly(calendar, calId, stale);
  }

  if (eventId) {
    await calendar.events.patch({
      calendarId: calId,
      eventId,
      requestBody: {
        start: { dateTime: group.start.toISOString(), timeZone: TZ },
        end: { dateTime: group.end.toISOString(), timeZone: TZ },
      },
    });
  } else {
    const res = await calendar.events.insert({
      calendarId: calId,
      requestBody: {
        summary: "Phoenix",
        start: { dateTime: group.start.toISOString(), timeZone: TZ },
        end: { dateTime: group.end.toISOString(), timeZone: TZ },
        reminders: EVENT_REMINDERS,
      },
    });
    eventId = res.data.id!;
  }

  await prisma.booking.updateMany({ where: { id: { in: group.ids } }, data: { secondaryEventId: eventId } });
  return eventId;
}

/**
 * Before a Bethnal booking's session is cancelled or moved: shrink the Chalk
 * Farm block it shared to fit whichever other confirmed bookings still need
 * it, splitting back into separate blocks if this one was the bridge between
 * two otherwise non-overlapping sessions, or delete it if no one else was
 * using it.
 */
async function releaseChalkFarmBlock(
  booking: { id: string; secondaryEventId: string },
  calendar: CalendarApi,
) {
  if (!booking.secondaryEventId) return;
  const eventId = booking.secondaryEventId;
  const sharers = await prisma.booking.findMany({
    where: { clinic: "bethnal", status: "confirmed", secondaryEventId: eventId, id: { not: booking.id } },
  });
  const calId = await calendarId("chalkFarm");

  if (sharers.length === 0) {
    await deleteEventQuietly(calendar, calId, eventId);
    return;
  }

  const groups = mergeBethnalBlocks(sharers.map((b) => ({ id: b.id, ...blockedRange("bethnal", b.startsAt) })));
  const [first, ...rest] = groups;

  await calendar.events.patch({
    calendarId: calId,
    eventId,
    requestBody: {
      start: { dateTime: first.start.toISOString(), timeZone: TZ },
      end: { dateTime: first.end.toISOString(), timeZone: TZ },
    },
  });
  await prisma.booking.updateMany({ where: { id: { in: first.ids } }, data: { secondaryEventId: eventId } });

  for (const g of rest) {
    const res = await calendar.events.insert({
      calendarId: calId,
      requestBody: {
        summary: "Phoenix",
        start: { dateTime: g.start.toISOString(), timeZone: TZ },
        end: { dateTime: g.end.toISOString(), timeZone: TZ },
        reminders: EVENT_REMINDERS,
      },
    });
    await prisma.booking.updateMany({ where: { id: { in: g.ids } }, data: { secondaryEventId: res.data.id! } });
  }
}

/** Delete a booking's Google events (tolerates already-deleted events). */
export async function deleteBookingGoogleEvents(booking: {
  id: string;
  clinic: string;
  personalEventId: string;
  secondaryEventId: string;
}) {
  const calendar = await getCalendarApi();
  if (booking.personalEventId) {
    await deleteEventQuietly(calendar, await calendarId("personal"), booking.personalEventId);
  }
  if (booking.clinic === "waterloo") {
    if (booking.secondaryEventId) {
      await deleteEventQuietly(calendar, await calendarId("room"), booking.secondaryEventId);
    }
  } else {
    await releaseChalkFarmBlock(booking, calendar);
  }
}

/** Cancel a booking: delete both Google events and mark the row cancelled. */
export async function cancelBookingEvents(bookingId: string) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  await deleteBookingGoogleEvents(booking);
  await prisma.booking.update({ where: { id: bookingId }, data: { status: "cancelled" } });
}

export type SpanSource = "booking" | "room" | "chalkFarm" | "personal";

export interface BusySpan {
  start: Date;
  end: Date;
  /** Human explanation of what's blocking the slot. */
  title: string;
  /** true when this is one of our own known bookings/blocks (vs. a genuine outside commitment) */
  known: boolean;
  /** which calendar (or our own bookings table) the span came from */
  source: SpanSource;
  /** set on our own bookings — enables click-through to the client */
  clientId?: string;
  /** set on our own bookings — enables cancel/reschedule */
  bookingId?: string;
  clinic?: Clinic;
}

/**
 * Everything blocking time in a window: our own bookings (named, with client
 * and booking ids) plus real events from every connected Google calendar.
 * Used by the availability grid, the week/month calendar, and the enquiry picker.
 */
export async function getBusySpans(windowStart: Date, windowEnd: Date): Promise<BusySpan[]> {
  const bookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: new Date(windowStart.getTime() - 2 * 3600_000), lt: windowEnd } },
    include: { client: true },
  });
  // The booking span is the 1-hour session itself. The paired room / Chalk Farm
  // event stays visible (see below) so it renders side by side with the session.
  const known: BusySpan[] = bookings.map((b) => {
    const clinic = b.clinic as Clinic;
    const start = b.startsAt;
    const end = new Date(start.getTime() + 60 * 60_000);
    return {
      start,
      end,
      title: `${b.client.name} — ${clinic === "waterloo" ? "Waterloo" : "Bethnal Green"}`,
      known: true,
      source: "booking" as const,
      clientId: b.clientId,
      bookingId: b.id,
      clinic,
    };
  });
  // Only the personal-calendar event is suppressed — the booking span already
  // represents it. The room / Chalk Farm event is kept so it shows alongside,
  // tagged `known` when it's ours (so the picker can tell a shared travel
  // buffer apart from a genuine outside commitment on that calendar).
  const ownEventIds = new Set(bookings.map((b) => b.personalEventId).filter(Boolean));
  const ownSecondaryEventIds = new Set(bookings.map((b) => b.secondaryEventId).filter(Boolean));

  const calendar = await getCalendarApi();
  const sources: Array<{ id: string; source: SpanSource }> = [
    { id: await calendarId("personal"), source: "personal" },
  ];
  // Room/Chalk Farm calendars are optional until configured in Settings.
  for (const key of ["room", "chalkFarm"] as const) {
    try {
      sources.push({ id: await calendarId(key), source: key });
    } catch {
      /* not configured yet */
    }
  }

  const google: BusySpan[] = [];
  for (const { id, source } of sources) {
    try {
      const res = await calendar.events.list({
        calendarId: id,
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      });
      for (const ev of res.data.items ?? []) {
        if (!ev.id || ownEventIds.has(ev.id)) continue;
        if (ev.transparency === "transparent" || ev.status === "cancelled") continue;
        const startISO = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
        const endISO = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
        if (!startISO || !endISO || !ev.start?.dateTime) continue; // skip all-day events
        const known = (source === "room" || source === "chalkFarm") && ownSecondaryEventIds.has(ev.id);
        google.push({
          start: new Date(startISO),
          end: new Date(endISO),
          title: ev.summary || "Busy",
          known,
          source,
        });
      }
    } catch {
      // events.list can 403 on freeBusyReader-only calendars — fall back to opaque busy blocks.
      try {
        const fb = await calendar.freebusy.query({
          requestBody: {
            timeMin: windowStart.toISOString(),
            timeMax: windowEnd.toISOString(),
            timeZone: TZ,
            items: [{ id }],
          },
        });
        for (const cal of Object.values(fb.data.calendars ?? {})) {
          for (const span of cal.busy ?? []) {
            if (!span.start || !span.end) continue;
            const start = new Date(span.start);
            const end = new Date(span.end);
            const isOwn = known.some((k) => start < k.end && end > k.start);
            if (!isOwn) google.push({ start, end, title: "Busy", known: false, source });
          }
        }
      } catch {
        /* calendar unreachable — skip it rather than failing the whole view */
      }
    }
  }
  return [...known, ...google].sort((a, b) => a.start.getTime() - b.start.getTime());
}
