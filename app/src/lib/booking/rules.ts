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

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** The exact calendar events a booking creates. Pure — unit-tested. */
export function planBookingEvents(
  clinic: Clinic,
  clientName: string,
  sessionStart: Date,
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

export interface BethnalBlock {
  id: string;
  start: Date;
  end: Date;
}

export interface MergedBethnalGroup {
  ids: string[];
  start: Date;
  end: Date;
}

/**
 * Bethnal Green sessions booked close together share one Chalk Farm block
 * instead of each getting its own overlapping one — e.g. 6–7pm and
 * 7:15–8:15pm merge into a single 5:30pm–8:45pm block, since she's already
 * on site for both. Groups blocks that overlap (directly or transitively)
 * and unions each group's time range. Pure — unit-tested.
 */
export function mergeBethnalBlocks(blocks: BethnalBlock[]): MergedBethnalGroup[] {
  const remaining = [...blocks];
  const groups: MergedBethnalGroup[] = [];
  while (remaining.length) {
    const seed = remaining.shift()!;
    let group: MergedBethnalGroup = { ids: [seed.id], start: seed.start, end: seed.end };
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const b = remaining[i];
        if (b.start < group.end && b.end > group.start) {
          group = {
            ids: [...group.ids, b.id],
            start: b.start < group.start ? b.start : group.start,
            end: b.end > group.end ? b.end : group.end,
          };
          remaining.splice(i, 1);
          grew = true;
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

export interface BusySpanLite {
  start: Date;
  end: Date;
  source: CalendarKey | "booking";
  /** true for our own bookings/calendar events (vs. a genuine outside commitment) */
  known: boolean;
  clinic?: Clinic;
}

/**
 * Whether a candidate slot conflicts with existing bookings/calendar spans.
 * Two Bethnal sessions booked close together share one travel buffer, so a
 * Bethnal candidate only needs to clear other Bethnal *sessions* (not their
 * buffer) and never conflicts with our own Chalk Farm block — booking it
 * just grows the block to include it. Everything else (a different clinic,
 * or a genuine outside commitment) still needs the full buffered range.
 */
export function slotConflicts(clinic: Clinic, slot: Date, spans: BusySpanLite[]): boolean {
  const session = { start: slot, end: addMinutes(slot, SESSION_MINUTES) };
  const buffered = blockedRange(clinic, slot);
  return spans.some((s) => {
    if (clinic === "bethnal") {
      if (s.source === "chalkFarm" && s.known) return false;
      if (s.source === "booking" && s.clinic === "bethnal") {
        return s.start < session.end && s.end > session.start;
      }
    }
    return s.start < buffered.end && s.end > buffered.start;
  });
}
