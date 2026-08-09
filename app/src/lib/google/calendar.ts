import { prisma, getSettings } from "@/lib/db";
import {
  EVENT_REMINDERS,
  planBookingEvents,
  type Clinic,
} from "@/lib/booking/rules";
import { calendarId, getCalendarApi, withRetry } from "./client";
import { syncChalkFarmDayBlock } from "./chalkFarm";
import { fmtTime, londonDateKey } from "@/lib/time";

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
  const settings = await getSettings();
  const clinic = booking.clinic as Clinic;
  const address = clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
  // Venue-facing note for the room event — what the clinic needs (the session time
  // and how to reach Phoenix), without the client's name on the shared calendar.
  const sessionEnd = new Date(booking.startsAt.getTime() + 60 * 60_000);
  const venueNote = [
    `Craniosacral session ${fmtTime(booking.startsAt)}–${fmtTime(sessionEnd)}.`,
    settings.clinicContactLine.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  const plan = planBookingEvents(clinic, booking.client.name, booking.startsAt, address, venueNote);

  let personalEventId = "";
  let secondaryEventId = "";
  for (const ev of plan) {
    const calId = await calendarId(ev.calendar);
    const res = await withRetry(() =>
      calendar.events.insert({
        calendarId: calId,
        sendUpdates: ev.inviteClient && booking.client.email ? "all" : "none",
        requestBody: {
          summary: ev.summary,
          description: ev.description || undefined,
          location: ev.location || undefined,
          start: { dateTime: ev.start.toISOString(), timeZone: TZ },
          end: { dateTime: ev.end.toISOString(), timeZone: TZ },
          reminders: EVENT_REMINDERS,
          attendees:
            ev.inviteClient && booking.client.email
              ? [{ email: booking.client.email, displayName: booking.client.name }]
              : undefined,
        },
      }),
    );
    if (ev.calendar === "personal") personalEventId = res.data.id!;
    else secondaryEventId = res.data.id!;
    // Persist each event id as soon as it's created — a later failure (e.g. the
    // Chalk Farm sync below) then can't orphan an already-created event.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { personalEventId, secondaryEventId },
    });
  }
  if (clinic === "bethnal") {
    try {
      await syncChalkFarmDayBlock(londonDateKey(booking.startsAt));
    } catch (err) {
      // The session itself is booked — the shared placeholder block is a nice-
      // to-have that self-heals next time this day's block is synced. Don't
      // fail the whole booking over it.
      console.error("Chalk Farm day-block sync failed (booking still stands)", err);
    }
  }
  return { personalEventId, secondaryEventId };
}

/**
 * Retroactively add the client as an attendee on their upcoming booked
 * session(s), so Google emails them the calendar invite. Used once we learn a
 * client's email after they were booked without one (e.g. a WhatsApp enquiry
 * where the email arrives via the intake form). Idempotent — skips a booking
 * the client is already invited to — and stamps `calendarInviteSharedAt`.
 */
export async function shareCalendarInvite(clientId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (!client.email) return;

  const bookings = await prisma.booking.findMany({
    where: { clientId, status: "confirmed", startsAt: { gte: new Date() }, personalEventId: { not: "" } },
    orderBy: { startsAt: "asc" },
  });
  if (!bookings.length) return;

  const calendar = await getCalendarApi();
  const calId = await calendarId("personal");
  let shared = false;
  for (const booking of bookings) {
    try {
      const ev = await calendar.events.get({ calendarId: calId, eventId: booking.personalEventId });
      const alreadyInvited = (ev.data.attendees ?? []).some(
        (a) => a.email?.toLowerCase() === client.email.toLowerCase(),
      );
      if (alreadyInvited) continue;
      await calendar.events.patch({
        calendarId: calId,
        eventId: booking.personalEventId,
        sendUpdates: "all",
        requestBody: {
          attendees: [...(ev.data.attendees ?? []), { email: client.email, displayName: client.name }],
        },
      });
      shared = true;
    } catch (err) {
      console.error("shareCalendarInvite failed for booking", booking.id, err);
    }
  }
  if (shared) {
    await prisma.client.update({ where: { id: clientId }, data: { calendarInviteSharedAt: new Date() } });
  }
}

/** Delete a booking's Google events (tolerates already-deleted events). */
export async function deleteBookingGoogleEvents(booking: {
  clinic: string;
  personalEventId: string;
  secondaryEventId: string;
}) {
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
}

/**
 * Cancel a booking: delete both Google events and mark the row cancelled.
 * `by` records who did it — "client" when they cancelled from their own page,
 * "admin" when Phoenix did, blank when it's an internal replacement (rebooking).
 */
export async function cancelBookingEvents(bookingId: string, by = "") {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  await deleteBookingGoogleEvents(booking);
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "cancelled", cancelledAt: new Date(), cancelledBy: by },
  });
  if (booking.clinic === "bethnal") await syncChalkFarmDayBlock(londonDateKey(booking.startsAt));
}

export type SpanSource = "booking" | "room" | "chalkFarm" | "personal";

export interface BusySpan {
  start: Date;
  end: Date;
  /** Human explanation of what's blocking the slot. */
  title: string;
  /** true when this is one of our own known bookings (vs. Google calendar time) */
  known: boolean;
  /** which calendar (or our own bookings table) the span came from */
  source: SpanSource;
  /** set on our own bookings — enables click-through to the client */
  clientId?: string;
  /** set on our own bookings — enables cancel/reschedule */
  bookingId?: string;
  clinic?: Clinic;
  /** Google's event id — set on real Google events (not our bookings / opaque
   * free-busy blocks); enables editing/deleting the event in place. */
  googleEventId?: string;
  /** true for the shared Chalk Farm day block — shown for visibility, but
   * ignored by every availability/collision check (only real sessions block
   * time; see syncChalkFarmDayBlock). */
  roomBlock?: boolean;
}

/**
 * Everything blocking time in a window: our own bookings (named, with client
 * and booking ids) plus real events from every connected Google calendar.
 * Used by the availability grid, the week/month calendar, and the enquiry picker.
 */
export async function getBusySpans(windowStart: Date, windowEnd: Date): Promise<BusySpan[]> {
  // These three are independent — fetch our confirmed bookings, the Chalk Farm
  // day blocks, and the Google client together rather than back to back.
  const [bookings, chalkFarmBlocks, calendar] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "confirmed", startsAt: { gte: new Date(windowStart.getTime() - 2 * 3600_000), lt: windowEnd } },
      include: { client: true },
    }),
    prisma.chalkFarmDayBlock.findMany({
      where: { date: { gte: londonDateKey(windowStart), lt: londonDateKey(windowEnd) } },
    }),
    getCalendarApi(),
  ]);
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
  // represents it. The room / Chalk Farm event is kept so it shows alongside.
  const ownEventIds = new Set(bookings.map((b) => b.personalEventId).filter(Boolean));

  // The shared Chalk Farm day block(s) in this window — tagged `roomBlock` so
  // every collision check below can ignore them (only real sessions count).
  const chalkFarmBlockEventIds = new Set(chalkFarmBlocks.map((b) => b.eventId));

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

  // Each calendar is a separate network round-trip to Google. Fetch them all
  // concurrently — running them together instead of one after another is the
  // main speedup for the calendar and availability views.
  const perSource = await Promise.all(
    sources.map(async ({ id, source }): Promise<BusySpan[]> => {
      try {
        const res = await calendar.events.list({
          calendarId: id,
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        });
        const spans: BusySpan[] = [];
        for (const ev of res.data.items ?? []) {
          if (!ev.id || ownEventIds.has(ev.id)) continue;
          if (ev.transparency === "transparent" || ev.status === "cancelled") continue;
          const startISO = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
          const endISO = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
          if (!startISO || !endISO || !ev.start?.dateTime) continue; // skip all-day events
          spans.push({
            start: new Date(startISO),
            end: new Date(endISO),
            title: ev.summary || "Busy",
            known: false,
            source,
            googleEventId: ev.id,
            roomBlock: source === "chalkFarm" && chalkFarmBlockEventIds.has(ev.id),
          });
        }
        return spans;
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
          const spans: BusySpan[] = [];
          for (const cal of Object.values(fb.data.calendars ?? {})) {
            for (const span of cal.busy ?? []) {
              if (!span.start || !span.end) continue;
              const start = new Date(span.start);
              const end = new Date(span.end);
              const isOwn = known.some((k) => start < k.end && end > k.start);
              if (!isOwn) spans.push({ start, end, title: "Busy", known: false, source });
            }
          }
          return spans;
        } catch {
          /* calendar unreachable — skip it rather than failing the whole view */
          return [];
        }
      }
    }),
  );

  const google = perSource.flat();
  return [...known, ...google].sort((a, b) => a.start.getTime() - b.start.getTime());
}
