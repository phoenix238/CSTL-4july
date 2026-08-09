/**
 * Matching a bank payment to a client by their reference.
 *
 * Pure and unit-tested, because getting this wrong means crediting one person's
 * money to another. The rule is deliberately strict: a reference matches only
 * when it equals a client's reference outright, or appears as a whole word
 * inside it. Nothing is guessed from the sender's name — two clients called Jono
 * are exactly the case references exist to solve.
 */

/** Upper-case, letters and digits only — how a reference is compared. */
export function normaliseRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface RefCandidate {
  clientId: string;
  paymentRef: string;
}

export type MatchResult =
  | { status: "matched"; clientId: string }
  | { status: "none" }
  /** More than one client's reference fits — never guess between them. */
  | { status: "ambiguous"; clientIds: string[] };

/**
 * Find which client a payment reference belongs to.
 *
 * Substring matching is deliberately NOT used. "JS4" is a substring of "JS41",
 * so a contains-check would quietly pay off the wrong client the moment the
 * counter passes ten. Instead the reference must match the whole normalised
 * string, or one of its whole words once split on punctuation and spaces —
 * so "Session JS4" matches JS4, and "JS41" does not.
 */
export function matchReference(reference: string, candidates: RefCandidate[]): MatchResult {
  const whole = normaliseRef(reference);
  if (!whole) return { status: "none" };

  // Words as the payer typed them, so "CSTL JS4 August" yields JS4 on its own.
  const words = new Set(
    reference
      .split(/[^A-Za-z0-9]+/)
      .map(normaliseRef)
      .filter(Boolean),
  );
  words.add(whole);

  const hits = new Set<string>();
  for (const c of candidates) {
    const ref = normaliseRef(c.paymentRef);
    if (ref && words.has(ref)) hits.add(c.clientId);
  }

  const ids = [...hits];
  if (ids.length === 1) return { status: "matched", clientId: ids[0] };
  if (ids.length > 1) return { status: "ambiguous", clientIds: ids };
  return { status: "none" };
}

export interface PayableBooking {
  id: string;
  startsAt: Date;
  paid: boolean;
  amountPence: number | null;
  status: string;
}

/**
 * Which of a client's sessions a payment should settle.
 *
 * Oldest unpaid session that has already happened, because that's the one
 * that's been owed longest. If everything past is settled, it falls to their
 * next upcoming session — someone paying ahead of a session is common, and
 * refusing to credit it would leave the money looking unmatched.
 *
 * Cancelled sessions are never chosen: money against a session that didn't
 * happen is a goodwill contribution, and that's a judgement call, not something
 * to apply automatically.
 */
export function chooseBookingToSettle(bookings: PayableBooking[], now = new Date()): PayableBooking | null {
  const open = bookings
    .filter((b) => !b.paid && b.status !== "cancelled")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return open.find((b) => b.startsAt.getTime() <= now.getTime()) ?? open[0] ?? null;
}
