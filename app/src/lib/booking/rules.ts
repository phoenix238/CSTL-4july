// Phoenix's booking rules — the heart of the control tower.
//
//   Waterloo (£80 · 60 min):
//     1h  "Craniosacral therapy"  on the personal calendar (location: the real address)
//     1h  "R5 - Phoenix"          on the room calendar
//
//   Bethnal Green (£30–60 sliding · 60 min):
//     1h  "Craniosacral therapy"  on the personal calendar (location: the real address)
//     A single shared "Phoenix" block on the Chalk Farm calendar, one per day,
//     auto-sized to span that day's Bethnal sessions — see
//     src/lib/google/chalkFarm.ts. Not part of planBookingEvents: it's kept in
//     sync separately whenever a Bethnal booking is created/moved/cancelled,
//     so sessions can sit as close together as the schedule allows.
//
// No client name goes on any calendar event — not the title, not the location.
// The location DOES stay the real street address, same as before: Google
// geocodes a plain address into a map pin (a URL in this field wouldn't), and
// that's what lets Phoenix and the client tap through to navigate. Anonymising
// the calendar was only ever about the client's *name* — who a session is with
// is looked up in the app (Today / This Week), which reads from the database.
// The client is still invited to their own session as an attendee, so they get
// the invite + reminders.
//
// All events get reminders: email 24h before, popup 1h before.

export type Clinic = "waterloo" | "bethnal";

export type CalendarKey = "personal" | "room" | "chalkFarm" | "availability";

export interface PlannedEvent {
  calendar: CalendarKey;
  summary: string;
  start: Date;
  end: Date;
  /** the client is invited (receives the Google Calendar invite) */
  inviteClient: boolean;
  /** clinic address — shown on the invite and turned into a Google Maps link */
  location?: string;
  /** event body — used on the venue-facing room event to tell the clinic what
   * they need (session time, a contact line) without exposing the client's name */
  description?: string;
  /** Google event colour id — see CLINIC_EVENT_COLOR */
  colorId?: string;
}

export const SESSION_MINUTES = 60;

/** The title on every session's calendar event — deliberately generic, so no
 *  client name ever appears on a Google calendar. */
export const SESSION_EVENT_TITLE = "Craniosacral therapy";

export const CLINIC_LABEL: Record<Clinic, string> = {
  waterloo: "Waterloo",
  bethnal: "Bethnal Green",
};

/**
 * Clinic labels for the client-facing booking selectors — the public /book page
 * and the client portal. Kept separate from CLINIC_LABEL on purpose: the "low
 * cost" framing belongs where a client is choosing where to book, not on
 * calendar events, invites, emails, receipts, or session history, which all
 * stay on the plain CLINIC_LABEL.
 */
export const CLINIC_BOOKING_LABEL: Record<Clinic, string> = {
  waterloo: CLINIC_LABEL.waterloo,
  bethnal: "Low cost Bethnal Green",
};

export const CLINIC_PRICE: Record<Clinic, string> = {
  waterloo: "£80",
  bethnal: "£30–60 sliding scale",
};

/**
 * Which colour each clinic's session shows as in Google Calendar, so a glance
 * at the phone says where you're meant to be without opening anything.
 *
 * These ids index Google's *event* palette, which is a fixed set of eleven:
 * Lavender 1, Sage 2, Grape 3, Flamingo 4, Banana 5, Tangerine 6, Peacock 7,
 * Graphite 8, Blueberry 9, Basil 10, Tomato 11. The longer list of names
 * including Cherry Blossom belongs to the palette for colouring a whole
 * calendar, and can't be applied to a single event — so Bethnal Green uses
 * Flamingo (#e67c73), the blossom pink of the set that is available.
 */
export const CLINIC_EVENT_COLOR: Record<Clinic, string> = {
  bethnal: "4", // Flamingo — the event palette's cherry-blossom pink
  waterloo: "6", // Tangerine
};

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/**
 * The exact calendar events a booking creates. Pure — unit-tested.
 *
 * No client name is passed in or placed on any event: the session title is
 * always the generic SESSION_EVENT_TITLE. `address`, if given, is the real
 * street address — used as-is for `location`, so Google can still geocode a
 * pin and both Phoenix and the client can tap through to navigate. Falls back
 * to the clinic name only when no address has been set yet in Settings.
 */
export function planBookingEvents(
  clinic: Clinic,
  sessionStart: Date,
  address?: string,
  /** venue-facing note for the room event's description (session time + contact
   * line); the caller composes it since it needs settings + London-time formatting */
  venueNote?: string,
): PlannedEvent[] {
  const sessionEnd = addMinutes(sessionStart, SESSION_MINUTES);
  const location = address?.trim() || CLINIC_LABEL[clinic];
  if (clinic === "waterloo") {
    return [
      {
        calendar: "personal",
        summary: SESSION_EVENT_TITLE,
        start: sessionStart,
        end: sessionEnd,
        inviteClient: true,
        location,
        colorId: CLINIC_EVENT_COLOR.waterloo,
      },
      {
        calendar: "room",
        summary: "R5 - Phoenix",
        start: sessionStart,
        end: sessionEnd,
        inviteClient: false,
        description: venueNote || undefined,
      },
    ];
  }
  // Bethnal Green: just the 1h session — the shared Chalk Farm room block is
  // computed separately (src/lib/google/chalkFarm.ts) from the day's bookings.
  return [
    {
      calendar: "personal",
      summary: SESSION_EVENT_TITLE,
      start: sessionStart,
      end: sessionEnd,
      inviteClient: true,
      location,
      colorId: CLINIC_EVENT_COLOR.bethnal,
    },
  ];
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
export function blockedRange(clinic: Clinic, sessionStart: Date) {
  return { start: sessionStart, end: addMinutes(sessionStart, SESSION_MINUTES) };
}
