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

export interface NameCandidate {
  clientId: string;
  name: string;
}

/** Words in a name, lower-cased, punctuation and initials-as-noise removed. */
function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * A *suggestion* — never an automatic match — of who a payment with no usable
 * reference came from, by the sender's bank name.
 *
 * Deliberately conservative and, like matchReference, it never guesses between
 * two: a client is a candidate only when every word of their name appears in the
 * sender's name (so "MR JONO SMITH" suggests "Jono Smith", but a bare "JONO"
 * suggests no one), and if more than one client fits, it suggests nobody. The
 * result is only ever a pre-selection on the manual queue for a human to confirm;
 * money is never credited on a name.
 */
export function suggestClientByName(counterParty: string, candidates: NameCandidate[]): string | null {
  const payer = new Set(nameTokens(counterParty));
  if (!payer.size) return null;

  const hits: string[] = [];
  for (const c of candidates) {
    const tokens = nameTokens(c.name).filter((t) => t.length > 1);
    if (!tokens.length) continue;
    if (tokens.every((t) => payer.has(t))) hits.push(c.clientId);
  }
  return hits.length === 1 ? hits[0] : null;
}

export interface PayableBooking {
  id: string;
  startsAt: Date;
  paid: boolean;
  amountPence: number | null;
  status: string;
}

/** How close, in days, a session has to be to the transfer to be settled automatically. */
export const SETTLE_WINDOW_DAYS = 8;

/**
 * Which of a client's sessions a payment should settle.
 *
 * Oldest unpaid session that has already happened, because that's the one
 * that's been owed longest. If everything past is settled, it falls to their
 * next upcoming session — someone paying ahead of a session is common, and
 * refusing to credit it would leave the money looking unmatched.
 *
 * Constrained to a window around the transfer date (`asOf`): a payment settles a
 * session only if it sits within `windowDays` before or after the transfer, so a
 * transfer can't quietly pay off a session from three weeks ago. Anything outside
 * the window is left unmatched for a human to place. Pass `windowDays: Infinity`
 * for a hand-assignment, where the person has already decided this payment is
 * theirs and only the session is in question.
 *
 * Cancelled sessions are never chosen: money against a session that didn't
 * happen is a goodwill contribution, and that's a judgement call, not something
 * to apply automatically.
 */
export function chooseBookingToSettle(
  bookings: PayableBooking[],
  asOf: Date = new Date(),
  windowDays: number = SETTLE_WINDOW_DAYS,
): PayableBooking | null {
  const open = bookings
    .filter((b) => !b.paid && b.status !== "cancelled")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const t = asOf.getTime();
  const windowMs = windowDays === Infinity ? Infinity : windowDays * 86_400_000;

  // A session that's already happened and sits within the window before the
  // transfer — been owed longest wins among those (the list is oldest-first).
  const past = open.find((b) => {
    const s = b.startsAt.getTime();
    return s <= t && t - s <= windowMs;
  });
  if (past) return past;

  // Otherwise their next upcoming session within the window after the transfer
  // (paying ahead). Further out than the window, it stays unmatched.
  const upcoming = open.find((b) => {
    const s = b.startsAt.getTime();
    return s > t && s - t <= windowMs;
  });
  return upcoming ?? null;
}
