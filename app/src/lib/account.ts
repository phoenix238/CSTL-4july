import type { Clinic } from "@/lib/booking/rules";

/**
 * What a client owes, and what they've already settled.
 *
 * Kept pure (no Prisma, no Google) so the money rules are unit-tested and can be
 * read in one place — both the client's own portal and Phoenix's admin view
 * compute their numbers from exactly this, so the two can never disagree.
 */

/** The subset of a Booking this module needs — structural, so tests need no DB. */
export interface AccountBooking {
  id: string;
  startsAt: Date;
  clinic: string;
  status: string; // confirmed | cancelled | done
  amountPence: number | null;
  paid: boolean;
  goodwillPence: number;
  goodwillSettled: boolean;
  goodwillWaived: boolean;
  goodwillReason: string;
}

/**
 * The standard price of a session, in pence.
 *
 * Waterloo is a fixed £80. Bethnal Green is a £30–60 sliding scale — the client
 * chooses, so there's no correct number to assume; it stays null until the real
 * amount is recorded. Nothing guesses a sliding-scale figure, because a wrong
 * guess in a balance is worse than a blank.
 */
export function defaultAmountPence(clinic: Clinic | string): number | null {
  return clinic === "waterloo" ? 8000 : null;
}

/** A session that has already happened and wasn't cancelled. */
function isCompleted(b: AccountBooking, now: Date): boolean {
  return b.status !== "cancelled" && b.startsAt.getTime() <= now.getTime();
}

/**
 * An outstanding goodwill contribution — suggested, and neither given nor waived.
 *
 * Kept strictly apart from the balance below. A goodwill ask is an invitation, so
 * folding it into "what you owe" would quietly turn it into a bill — which is
 * exactly what it isn't.
 */
export function goodwillOpenPence(b: AccountBooking): number {
  if (b.goodwillPence <= 0 || b.goodwillSettled || b.goodwillWaived) return 0;
  return b.goodwillPence;
}

/** What's still owed on the session itself. */
export function sessionOwedPence(b: AccountBooking, now: Date): number {
  if (!isCompleted(b, now) || b.paid) return 0;
  return b.amountPence ?? 0; // sliding-scale amount not yet set — counted separately
}

export interface AccountSummary {
  /** Sessions attended (past, not cancelled). */
  completedCount: number;
  /** Of those, how many are settled — the "how many have they paid for" number. */
  paidCount: number;
  /** Past sessions still unpaid. */
  unpaidCount: number;
  /** Unpaid sessions only, in pence. Goodwill is deliberately excluded. */
  balancePence: number;
  /** Open goodwill contributions, in pence — shown separately, never as debt. */
  goodwillPence: number;
  /**
   * Past unpaid sessions whose amount was never set (a Bethnal sliding scale
   * nobody filled in). They're genuinely owed but can't be totalled, so they're
   * surfaced as a count instead of being silently valued at zero.
   */
  unpricedCount: number;
}

export function summariseAccount(bookings: AccountBooking[], now = new Date()): AccountSummary {
  let completedCount = 0;
  let paidCount = 0;
  let unpaidCount = 0;
  let balancePence = 0;
  let goodwillPence = 0;
  let unpricedCount = 0;

  for (const b of bookings) {
    if (isCompleted(b, now)) {
      completedCount++;
      if (b.paid) {
        paidCount++;
      } else {
        unpaidCount++;
        if (b.amountPence == null) unpricedCount++;
        balancePence += sessionOwedPence(b, now);
      }
    }
    goodwillPence += goodwillOpenPence(b);
  }

  return { completedCount, paidCount, unpaidCount, balancePence, goodwillPence, unpricedCount };
}

/** "£80", "£12.50" — pence to a clean human amount. */
export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return `£${Number.isInteger(pounds) ? pounds.toString() : pounds.toFixed(2)}`;
}

/**
 * What to show a client against one session.
 *
 * A recorded amount always wins — that's what actually changed hands. Otherwise
 * Waterloo shows its fixed £80, and Bethnal Green shows the sliding scale itself
 * rather than a number, because on a donation basis the amount is the client's
 * to decide and naming one would quietly turn a scale into a price.
 */
export function sessionPriceLabel(clinic: Clinic | string, amountPence: number | null): string {
  if (amountPence != null) return formatPence(amountPence);
  return clinic === "waterloo" ? "£80" : "£30–60 sliding scale";
}

/**
 * Hours of notice between now and a session. Negative once it's started.
 * Fractional on purpose — a session 23.5h away is inside a 24h window.
 */
export function hoursUntil(startsAt: Date, now = new Date()): number {
  return (startsAt.getTime() - now.getTime()) / 3_600_000;
}

/**
 * Can the client move this session themselves?
 *
 * Only with the full notice period. Inside it, moving a session is the same
 * imposition as cancelling one, so it goes through Phoenix rather than being
 * a free way around the late-cancellation fee.
 */
export function canRescheduleSelf(startsAt: Date, noticeHours: number, now = new Date()): boolean {
  return hoursUntil(startsAt, now) >= noticeHours;
}

/**
 * Cancelling is always allowed — a client who can't come should say so, and a
 * portal that blocks them just turns into a no-show.
 *
 * Inside the notice window they're *invited* to contribute towards the room. The
 * cancellation goes through either way; nothing is withheld and nothing is
 * charged. Returns 0 when they gave enough notice, or when the suggestion is
 * switched off.
 */
export function suggestedGoodwillPence(
  startsAt: Date,
  noticeHours: number,
  goodwillPence: number,
  now = new Date(),
): number {
  return hoursUntil(startsAt, now) < noticeHours ? goodwillPence : 0;
}
