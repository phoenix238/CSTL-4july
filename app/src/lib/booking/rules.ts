// Phoenix's booking rules — the heart of the control tower.
//
//   Waterloo (£80 · 60 min):
//     1h  "(Client) — Waterloo"  on the personal calendar
//     1h  "R5 - Phoenix"         on the room calendar
//
//   Bethnal Green (£30–60 sliding · 60 min):
//     1h  "(Client) — Bethnal Green"   on the personal calendar
//     A single shared "Phoenix" block on the Chalk Farm calendar, one per day,
//     auto-sized to span that day's Bethnal sessions — see
//     src/lib/google/chalkFarm.ts. Not part of planBookingEvents: it's kept in
//     sync separately whenever a Bethnal booking is created/moved/cancelled,
//     so sessions can sit as close together as the schedule allows.
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
}

export const SESSION_MINUTES = 60;

export const CLINIC_LABEL: Record<Clinic, string> = {
  waterloo: "Waterloo",
  bethnal: "Bethnal Green",
};

export const CLINIC_PRICE: Record<Clinic, string> = {
  waterloo: "£80",
  bethnal: "£30–60 sliding scale",
};

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** The exact calendar events a booking creates. Pure — unit-tested. */
export function planBookingEvents(
  clinic: Clinic,
  clientName: string,
  sessionStart: Date,
  address?: string,
): PlannedEvent[] {
  const sessionEnd = addMinutes(sessionStart, SESSION_MINUTES);
  if (clinic === "waterloo") {
    return [
      {
        calendar: "personal",
        summary: `${clientName} — Waterloo`,
        start: sessionStart,
        end: sessionEnd,
        inviteClient: true,
        location: address || undefined,
      },
      {
        calendar: "room",
        summary: "R5 - Phoenix",
        start: sessionStart,
        end: sessionEnd,
        inviteClient: false,
      },
    ];
  }
  // Bethnal Green: just the 1h session — the shared Chalk Farm room block is
  // computed separately (src/lib/google/chalkFarm.ts) from the day's bookings.
  return [
    {
      calendar: "personal",
      summary: `${clientName} — Bethnal Green`,
      start: sessionStart,
      end: sessionEnd,
      inviteClient: true,
      location: address || undefined,
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
