// The booking rules — the heart of the control tower.
//
// Every session is at one of your spaces (lib/spaces.ts), and the space decides
// what a booking puts on Google Calendar:
//
//   always      1h  "Craniosacral therapy" on your own calendar
//                   (location: the space's real address, in the space's colour)
//   room        1h  the venue title (e.g. "R5 - Phoenix") on the venue's calendar
//   dayBlock    a shared block per cluster of sessions on the venue's calendar,
//               auto-sized to span them — kept in sync separately whenever a
//               session there is created/moved/cancelled (google/chalkFarm.ts),
//               so sessions can sit as close together as the schedule allows.
//
// No client name goes on any calendar event — not the title, not the location.
// The location DOES stay the real street address, same as before: Google
// geocodes a plain address into a map pin (a URL in this field wouldn't), and
// that's what lets Phoenix and the client tap through to navigate. Anonymising
// the calendar was only ever about the client's *name* — who a session is with
// is looked up in the app (Today / This Week), which reads from the database.
// The client is still added as an attendee on their own session, so it lands
// silently on their own Google Calendar if they have one — but never emailed:
// Google's own invite/notification email duplicates (and confusingly
// mis-formats) our own confirmation email, so every calendar mutation on a
// booking sends with sendUpdates: "none". The confirmation email's own
// add-to-calendar links are the one channel that actually tells the client.
//
// Reminders on each event are configurable — Phoenix's own in Settings (see
// personalEventReminders below), the client's own on their portal.

import type { Space } from "@/lib/spaces";

/**
 * The id of a space a session is at — see lib/spaces.ts. Kept under its old
 * name: it's what Booking.clinic, Client.clinic and the availability rows store,
 * and on an install that predates spaces it's still "waterloo" or "bethnal".
 */
export type Clinic = string;

/** "personal" = your own calendar; "venue" = the space's shared venue calendar. */
export type CalendarKey = "personal" | "availability";

export interface PlannedEvent {
  calendar: "personal" | "venue";
  summary: string;
  start: Date;
  end: Date;
  /** the client is invited (receives the Google Calendar invite) */
  inviteClient: boolean;
  /** space address — shown on the invite and turned into a Google Maps link */
  location?: string;
  /** event body — used on the venue-facing room event to tell the venue what
   * they need (session time, a contact line) without exposing the client's name */
  description?: string;
  /** Google event colour id — the space's eventColor */
  colorId?: string;
}

export const SESSION_MINUTES = 60;

/** The title on every session's calendar event — deliberately generic, so no
 *  client name ever appears on a Google calendar. */
export const SESSION_EVENT_TITLE = "Craniosacral therapy";

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/**
 * The exact calendar events a booking creates. Pure — unit-tested.
 *
 * Always your own session event, at the space's address in its colour. A space
 * whose venue books per session ("room") also gets its own event on the venue
 * calendar under the venue title. A "dayBlock" venue isn't planned here — its
 * shared block is computed from the whole day's sessions (google/chalkFarm.ts).
 *
 * No client name is placed on any event: the session title is always the
 * generic SESSION_EVENT_TITLE. The location is the real street address, so
 * Google can still geocode a pin; it falls back to the space's name only when
 * no address has been set yet.
 */
export function planBookingEvents(
  space: Space,
  sessionStart: Date,
  /** venue-facing note for the room event's description (session time + contact
   * line); the caller composes it since it needs settings + London-time formatting */
  venueNote?: string,
): PlannedEvent[] {
  const sessionEnd = addMinutes(sessionStart, SESSION_MINUTES);
  const events: PlannedEvent[] = [
    {
      calendar: "personal",
      summary: SESSION_EVENT_TITLE,
      start: sessionStart,
      end: sessionEnd,
      inviteClient: true,
      location: space.address.trim() || space.name,
      colorId: space.eventColor,
    },
  ];
  if (space.venueMode === "room") {
    events.push({
      calendar: "venue",
      summary: space.venueEventTitle.trim() || space.name,
      start: sessionStart,
      end: sessionEnd,
      inviteClient: false,
      description: venueNote || undefined,
    });
  }
  return events;
}

/**
 * The legacy reminder pair — an email a day before and a popup an hour before.
 * Kept as the "email_popup" option and as what a venue event carries when
 * venue reminders are turned on.
 */
export const EVENT_REMINDERS = {
  useDefault: false,
  overrides: [
    { method: "email" as const, minutes: 24 * 60 },
    { method: "popup" as const, minutes: 60 },
  ],
};

/** No reminder at all on an event — Google sends nothing for this copy. */
export const NO_REMINDERS = { useDefault: false, overrides: [] as EventReminderOverride[] };

export type EventReminderOverride = { method: "email" | "popup"; minutes: number };
export interface EventReminders {
  useDefault: boolean;
  overrides: EventReminderOverride[];
}

/** How Phoenix wants reminding of his own sessions — the shape stored in settings. */
export interface OwnReminderConfig {
  /** "morning" | "before" | "email_popup" | "none" */
  ownReminderMode: string;
  /** minutes before the session, when mode = "before" */
  ownReminderMinutesBefore: number;
  /** London hour the morning-of popup fires, when mode = "morning" */
  ownReminderMorningHour: number;
}

// Google reminder offsets are whole minutes before the start, from 0 up to four weeks.
const clampMinutes = (m: number) => Math.max(0, Math.min(Math.round(m), 40320));

/**
 * The reminders to put on Phoenix's own copy of a session event. Pure so it can
 * be unit-tested without Google or the clock: it takes the session's minute of
 * the London day (e.g. 15:00 → 900) rather than a Date, since that's all the
 * "morning of" maths needs.
 *
 * "morning" turns the fixed morning hour into a relative offset — the only kind
 * Google event reminders support — so a 15:00 session set to an 08:00 morning
 * reminder becomes a popup 420 minutes before. A session at or before the
 * morning hour can't be reminded "that morning" any earlier than it starts, so
 * it falls back to the plain minutes-before popup instead of a useless 0.
 */
export function personalEventReminders(cfg: OwnReminderConfig, sessionMinuteOfDay: number): EventReminders {
  const beforePopup = (minutes: number): EventReminders => ({
    useDefault: false,
    overrides: [{ method: "popup", minutes: clampMinutes(minutes) }],
  });
  switch (cfg.ownReminderMode) {
    case "none":
      return NO_REMINDERS;
    case "email_popup":
      return EVENT_REMINDERS;
    case "before":
      return beforePopup(cfg.ownReminderMinutesBefore);
    case "morning":
    default: {
      const offset = sessionMinuteOfDay - cfg.ownReminderMorningHour * 60;
      // A session before the morning hour gets the plain minutes-before popup.
      return beforePopup(offset > 0 ? offset : cfg.ownReminderMinutesBefore);
    }
  }
}

/**
 * The time range a booking blocks out (for availability). Both clinics block
 * just the session hour — Bethnal no longer pads for a private room window,
 * since the shared Chalk Farm block (see chalkFarm.ts) doesn't factor into
 * availability itself, only the real 1h sessions do.
 */
export function blockedRange(_clinic: Clinic, sessionStart: Date) {
  return { start: sessionStart, end: addMinutes(sessionStart, SESSION_MINUTES) };
}
