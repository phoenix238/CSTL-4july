// Phoenix's booking rules — the heart of the control tower.
//
//   Waterloo (£80 · 60 min):
//     1h  "(Client) — Waterloo"  on the personal calendar
//     1h  "R5 - Phoenix"         on the room calendar
//
//   Bethnal Green (£30–60 sliding · 60 min):
//     2h  "Phoenix"                    on the Chalk Farm calendar
//     1h  "(Client) — Bethnal Green"   on the personal calendar, centred in the block
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
export const BETHNAL_BLOCK_MINUTES = 120;

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
  // Bethnal Green: the 1h session sits in the middle of the 2h Chalk Farm block
  const blockStart = addMinutes(sessionStart, -30);
  const blockEnd = addMinutes(blockStart, BETHNAL_BLOCK_MINUTES);
  return [
    {
      calendar: "personal",
      summary: `${clientName} — Bethnal Green`,
      start: sessionStart,
      end: sessionEnd,
      inviteClient: true,
      location: address || undefined,
    },
    {
      calendar: "chalkFarm",
      summary: "Phoenix",
      start: blockStart,
      end: blockEnd,
      inviteClient: false,
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
 * The time range a booking blocks out (for availability):
 * Waterloo blocks the hour; Bethnal blocks the full 2h Chalk Farm window.
 */
export function blockedRange(clinic: Clinic, sessionStart: Date) {
  if (clinic === "waterloo") {
    return { start: sessionStart, end: addMinutes(sessionStart, SESSION_MINUTES) };
  }
  return {
    start: addMinutes(sessionStart, -30),
    end: addMinutes(sessionStart, 90),
  };
}
