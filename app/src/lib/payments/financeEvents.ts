import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/**
 * The money facts of paid sessions, for Phoenix's finance app (Honey).
 *
 * Honey keeps the tax ledger; CSTL keeps the practice. This is the one thing
 * that crosses between them — and deliberately only money: when, how much, how
 * it was paid, which bank transaction settled it, and the client's payment
 * reference. No names, no notes, no health information, so the finance side
 * never holds anything clinical.
 */

export type FinanceMethod = "bank" | "cash" | "other";

export interface FinanceEvent {
  bookingId: string;
  paidAt: string;
  /** null when a sliding-scale session was marked paid without an amount. */
  amountPence: number | null;
  method: FinanceMethod;
  /** Starling's id for the transaction that settled it, when matched from the feed. */
  feedItemUid: string | null;
  paymentRef: string;
  receiptNumber: string;
  clinic: string;
  /** A short payment label ("Cash", "Card") — never the free-text note itself. */
  note: string;
}

/**
 * How a session was paid. A matched bank transaction is definitive; otherwise
 * the payment note is the only record, using the same conventions the receipt
 * PDF reads ("Cash…", "Bank transfer…"). Anything else — card, a free-text
 * note — is "other", which Honey lists for a decision rather than adding,
 * because a card reader's payout also lands in the bank.
 */
export function paymentMethod(note: string, hasBankTransaction: boolean): FinanceMethod {
  if (hasBankTransaction) return "bank";
  if (/^\s*cash/i.test(note)) return "cash";
  if (/^\s*bank transfer/i.test(note)) return "bank";
  return "other";
}

function methodLabel(method: FinanceMethod, note: string): string {
  if (method === "cash") return "Cash";
  if (method === "bank") return "Bank transfer";
  return /card/i.test(note) ? "Card" : "Other";
}

export function toFinanceEvent(
  booking: {
    id: string;
    paidAt: Date | null;
    startsAt: Date;
    amountPence: number | null;
    paymentNote: string;
    clinic: string;
    client: { paymentRef: string };
  },
  feedItemUid: string | null,
): FinanceEvent {
  const method = paymentMethod(booking.paymentNote, Boolean(feedItemUid));
  return {
    bookingId: booking.id,
    // A session marked paid before paidAt existed falls back to its own date.
    paidAt: (booking.paidAt ?? booking.startsAt).toISOString(),
    amountPence: booking.amountPence,
    method,
    feedItemUid,
    paymentRef: booking.client.paymentRef,
    receiptNumber: "",
    clinic: CLINIC_LABEL[booking.clinic as Clinic] ?? booking.clinic,
    note: methodLabel(method, booking.paymentNote),
  };
}
