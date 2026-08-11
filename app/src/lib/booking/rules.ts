// Phoenix's booking rules — the heart of the control tower.
//
//   Waterloo (£80 · 60 min):
//     1h  "Craniosacral therapy"  on the personal calendar (location: Waterloo)
//     1h  "R5 - Phoenix"          on the room calendar
//
//   Bethnal Green (£30–60 sliding · 60 min):
//     1h  "Craniosacral therapy"  on the personal calendar (location: Bethnal Green)
//     A single shared "Phoenix" block on the Chalk Farm calendar, one per day,
//     auto-sized to span that day's Bethnal sessions — see
//     src/lib/google/chalkFarm.ts. Not part of planBookingEvents: it's kept in
//     sync separately whenever a Bethnal booking is created/moved/cancelled,
//     so sessions can sit as close together as the schedule allows.
//
// No client name goes on any calendar event — not the title, not the location.
// Who a session is with is looked up in the app (Today / This Week), which reads
// from the database, so the Google calendars stay anonymous. The client is still
// invited to their own session as an attendee, so they get the invite + reminders.
//
// All events get reminders: email 24h before, popup 1h before.

export type Clinic = "waterloo" | "bethnal";

export type CalendarKey = "personal" | "room" | "chalkFarm";

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
}

export const SESSION_MINUTES = 60;

/** The title on every session's calendar event — deliberately generic, so no
 *  client name ever appears on a Google calendar. */
export const SESSION_EVENT_TITLE = "Craniosacral therapy";

export const CLINIC_LABEL: Record<Clinic, string> = {
  waterloo: "Waterloo",
  bethnal: "Bethnal Green",
};

export const CLINIC_PRICE: Record<Clinic, string> = {
  waterloo: "£80",
  bethnal: "£30–60 sliding scale",
};

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/**
 * The exact calendar events a booking creates. Pure — unit-tested.
 *
 * No client name is passed in or placed on any event: the session title is
 * always the generic SESSION_EVENT_TITLE and the location is the clinic name,
 * so the Google calendars never carry who a session is with.
 */
export function planBookingEvents(
  clinic: Clinic,
  sessionStart: Date,
  /** venue-facing note for the room event's description (session time + contact
   * line); the caller composes it since it needs settings + London-time formatting */
  venueNote?: string,
): PlannedEvent[] {
  const sessionEnd = addMinutes(sessionStart, SESSION_MINUTES);
  if (clinic === "waterloo") {
    return [
      {
        calendar: "personal",
        summary: SESSION_EVENT_TITLE,
        start: sessionStart,
        end: sessionEnd,
        inviteClient: true,
        location: CLINIC_LABEL.waterloo,
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
      location: CLINIC_LABEL.bethnal,
    },
  ];
}

/** Reminder overrides applied to every event we create. */
export const EVENT_REMINDERS = {
  useDefault: false,
  overrides: [
    { method: "email" as const, minutes: 24 * 60 },
    { method: "popup" as const, minutes: 60 },
  ],
};

/**
 * The time range a booking blocks out (for availability). Both clinics block
 * just the session hour — Bethnal no longer pads for a private room window,
 * since the shared Chalk Farm block (see chalkFarm.ts) doesn't factor into
 * availability itself, only the real 1h sessions do.
 */
export function blockedRange(clinic: Clinic, sessionStart: Date) {
  return { start: sessionStart, end: addMinutes(sessionStart, SESSION_MINUTES) };
}
