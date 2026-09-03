// The reminder lead times a client can choose from on their portal — how long
// before a session the app emails them. Deliberately day-granular: the app's
// scheduler runs once a day (Vercel Hobby caps it there), so "a week / a day /
// the morning before" are the honest options — anything finer than a day can't
// be promised at this cadence.
//
// Shared by the portal UI (the checkboxes), the API route (validating what a
// client sends), and the daily sweep (deciding what to send today), so the three
// can never drift out of agreement on what a valid choice is.

export interface ReminderLeadOption {
  /** days before the session; 0 = the morning of */
  days: number;
  label: string;
  hint: string;
}

export const REMINDER_LEAD_OPTIONS: ReminderLeadOption[] = [
  { days: 7, label: "A week before", hint: "Time to plan around it." },
  { days: 1, label: "The day before", hint: "The usual reminder." },
  { days: 0, label: "On the morning", hint: "A nudge the same day." },
];

/** The lead-day values a client is allowed to store, for validating input. */
export const VALID_LEAD_DAYS: number[] = REMINDER_LEAD_OPTIONS.map((o) => o.days);

/** The human label for one lead-day value ("The day before"), or "" if unknown. */
export function leadDayLabel(days: number): string {
  return REMINDER_LEAD_OPTIONS.find((o) => o.days === days)?.label ?? "";
}

/**
 * Clean a client-supplied list of lead days: keep only the allowed values, drop
 * duplicates, and order them soonest-to-send-first (largest lead first). An empty
 * result means reminders off, which is a valid choice.
 */
export function normaliseLeadDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const kept = new Set<number>();
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (VALID_LEAD_DAYS.includes(n)) kept.add(n);
  }
  return [...kept].sort((a, b) => b - a);
}
