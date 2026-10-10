import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { formatPence } from "@/lib/account";
import { fmtDayLong } from "@/lib/time";
import { fetchIncomingPayments, type BankPayment } from "@/lib/starling";
import { sendPendingReceiptIfAny } from "@/lib/receipt";
import {
  chooseBookingToSettle,
  matchReference,
  matchKnownPayer,
  matchNameAndAmount,
  suggestClientByName,
  type RefCandidate,
  type PayerCandidate,
  type MatchResult,
} from "./match";

type MatchedVia = "reference" | "payer" | "name" | "manual";

/**
 * Pull settled payments from the bank, match them to clients by reference, and
 * mark the right session paid.
 *
 * Safe to re-run at any time. Every payment is written once, keyed on Starling's
 * own transaction id, so a second run over the same window applies nothing new.
 * Payments that don't match are still recorded — an unmatched payment is
 * something to look at, not something to lose.
 */

export interface SyncSummary {
  /** payments seen in the window that we hadn't recorded before */
  newCount: number;
  /** of those, applied to a session */
  matchedCount: number;
  /** seen, but no reference we recognised */
  unmatchedCount: number;
  /** reference fitted more than one client — left for a human */
  ambiguousCount: number;
  /**
   * Payments recorded on an earlier run that couldn't be placed then, and now
   * could — usually because the session they pay for has since been booked.
   */
  rematchedCount: number;
  accountLabel?: string;
}

/** How far back an unplaced payment keeps being retried on each run. */
export const RETRY_UNPLACED_DAYS = 90;

/** Where the matcher would put a payment, before anything is written. */
type Placement =
  | { kind: "none" }
  | { kind: "ambiguous" }
  /** A client, but no session in the window — clientId only when it's trustworthy attribution. */
  | { kind: "noSession"; clientId?: string }
  | { kind: "matched"; clientId: string; target: PayableBookingRow; matchedVia: MatchedVia };

type PayableBookingRow = { id: string; startsAt: Date; paid: boolean; amountPence: number | null; status: string };

interface MatchContext {
  candidates: RefCandidate[];
  payerCandidates: PayerCandidate[];
  allClients: Array<{ id: string; name: string }>;
}

export async function syncBankPayments({ force = false }: { force?: boolean } = {}): Promise<SyncSummary> {
  const empty: SyncSummary = { newCount: 0, matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0, rematchedCount: 0 };
  const settings = await getSettings();
  if (!settings.starlingEnabled && !force) return empty;

  // Re-read a day behind the watermark: a transaction can settle after others
  // that came later, so an exact resume point would step over it. Re-reading is
  // free because the feedItemUid uniqueness makes reprocessing a no-op.
  const lookbackMs = settings.starlingLookbackDays * 86_400_000;
  const since = settings.starlingLastSyncAt
    ? new Date(settings.starlingLastSyncAt.getTime() - 86_400_000)
    : new Date(Date.now() - lookbackMs);

  const payments = await fetchIncomingPayments(since);

  const seen = payments.length
    ? await prisma.bankTransaction.findMany({
        where: { feedItemUid: { in: payments.map((p) => p.feedItemUid) } },
        select: { feedItemUid: true },
      })
    : [];
  const known = new Set(seen.map((s) => s.feedItemUid));
  const fresh = payments.filter((p) => !known.has(p.feedItemUid));

  // Payments an earlier run recorded but couldn't place. Matching is only ever
  // tried at the moment a payment is first seen, so without this a transfer that
  // arrived before its session was booked — or before the session came inside
  // the settle window — would sit unplaced forever, and every later scan would
  // report "nothing new". Rows a human set aside ("ignored") aren't retried.
  const retry = await prisma.bankTransaction.findMany({
    where: {
      status: { in: ["unmatched", "ambiguous"] },
      transactedAt: { gte: new Date(Date.now() - RETRY_UNPLACED_DAYS * 86_400_000) },
    },
    orderBy: { transactedAt: "asc" },
  });

  const allClients = await prisma.client.findMany({
    select: { id: true, name: true, paymentRef: true, knownPayerNames: true },
  });
  const ctx: MatchContext = {
    candidates: allClients
      .filter((c) => c.paymentRef)
      .map((c) => ({ clientId: c.id, paymentRef: c.paymentRef })),
    payerCandidates: allClients
      .filter((c) => c.knownPayerNames.length)
      .map((c) => ({ clientId: c.id, knownPayerNames: c.knownPayerNames })),
    allClients,
  };
  const nameOf = new Map(allClients.map((c) => [c.id, c.name]));

  const summary: SyncSummary = { ...empty, newCount: fresh.length };
  const applied: Array<{ payment: BankPayment; clientName: string; whenLabel: string; matchedVia: MatchedVia }> = [];
  const needsAttention: BankPayment[] = [];

  for (const payment of fresh) {
    const placed = await placePayment(payment, ctx);

    if (placed.kind === "none" || placed.kind === "ambiguous") {
      if (placed.kind === "none") summary.unmatchedCount++;
      else summary.ambiguousCount++;
      needsAttention.push(payment);
      await recordTransaction(payment, { status: placed.kind === "none" ? "unmatched" : "ambiguous" });
      continue;
    }
    if (placed.kind === "noSession") {
      // Their reference, but nothing outstanding within the window to put it
      // against — a prepayment for a session not yet booked, or a session too far
      // from the transfer to be sure. Recorded against the client so it isn't
      // lost, but no session is settled automatically. Later runs retry it.
      summary.unmatchedCount++;
      needsAttention.push(payment);
      await recordTransaction(payment, { status: "unmatched", clientId: placed.clientId });
      continue;
    }

    if (settings.starlingAutoMark) {
      await settleBooking(placed.target, payment, placed.matchedVia);
      await sendPendingReceiptIfAny(placed.clientId);
    }
    await recordTransaction(payment, {
      status: "matched",
      clientId: placed.clientId,
      bookingId: placed.target.id,
      matchedVia: placed.matchedVia,
    });
    summary.matchedCount++;
    applied.push({
      payment,
      clientName: nameOf.get(placed.clientId) ?? "A client",
      matchedVia: placed.matchedVia,
      whenLabel: fmtDayLong(placed.target.startsAt),
    });
  }

  for (const row of retry) {
    const payment: BankPayment = {
      feedItemUid: row.feedItemUid,
      transactedAt: row.transactedAt,
      amountPence: row.amountPence,
      reference: row.reference,
      counterParty: row.counterParty,
    };
    // A client already on the row was put there by a reference/payer match or
    // by hand — either way it's settled attribution, so only the session is
    // still in question.
    const placed = await placePayment(payment, ctx, row.clientId ?? undefined);
    if (placed.kind !== "matched") continue; // still nowhere to put it — leave the row exactly as it is

    // With auto-mark off a retried match is left for a human like any other —
    // the row stays in the queue rather than being half-applied.
    if (!settings.starlingAutoMark) continue;

    // Claim the row before touching the booking, so a payment assigned by hand
    // while this ran is never applied twice.
    const claimed = await prisma.bankTransaction.updateMany({
      where: { id: row.id, status: { in: ["unmatched", "ambiguous"] } },
      data: { status: "matched", clientId: placed.clientId, bookingId: placed.target.id, matchedVia: placed.matchedVia },
    });
    if (!claimed.count) continue;

    await settleBooking(placed.target, payment, placed.matchedVia);
    await sendPendingReceiptIfAny(placed.clientId);
    summary.rematchedCount++;
    applied.push({
      payment,
      clientName: nameOf.get(placed.clientId) ?? "A client",
      matchedVia: placed.matchedVia,
      whenLabel: fmtDayLong(placed.target.startsAt),
    });
  }

  await prisma.appSettings.update({ where: { id: 1 }, data: { starlingLastSyncAt: new Date() } });

  if (settings.starlingNotifyEmail && (applied.length || needsAttention.length)) {
    await notify(applied, needsAttention, settings.starlingAutoMark);
  }
  return summary;
}

/**
 * Decide where a payment goes, writing nothing. `knownClientId` is a client the
 * payment is already attributed to (a stored row being retried): it's used when
 * no automatic rule places the payment by itself.
 */
async function placePayment(payment: BankPayment, ctx: MatchContext, knownClientId?: string): Promise<Placement> {
  let result: MatchResult = matchReference(payment.reference, ctx.candidates);
  let matchedVia: MatchedVia = "reference";
  // No reference match — fall back to a payer a human has vouched for before.
  // An ambiguous *reference* is left as-is rather than retried here: that's a
  // real conflict between references, not something a remembered name should
  // paper over.
  if (result.status === "none") {
    const payerResult = matchKnownPayer(payment.counterParty, ctx.payerCandidates);
    if (payerResult.status !== "none") {
      result = payerResult;
      matchedVia = "payer";
    }
  }
  // Still nothing — a first payment with no reference. Their full name on the
  // transfer AND the exact price of the session it would settle, together.
  if (result.status === "none") {
    const nameResult = await matchOnNameAndAmount(payment, ctx.allClients);
    if (nameResult.status !== "none") {
      result = nameResult.status === "matched" ? { status: "matched", clientId: nameResult.clientId } : nameResult;
      matchedVia = "name";
    }
  }
  // Already attributed to someone, and no rule says otherwise.
  if (result.status === "none" && knownClientId) {
    result = { status: "matched", clientId: knownClientId };
    matchedVia = "manual";
  }

  if (result.status === "none") return { kind: "none" };
  if (result.status === "ambiguous") return { kind: "ambiguous" };

  const bookings = await prisma.booking.findMany({
    where: { clientId: result.clientId },
    select: { id: true, startsAt: true, paid: true, amountPence: true, status: true },
  });
  // Relative to when the money actually moved, and only sessions within the
  // window around it — a transfer shouldn't settle a session weeks away.
  const found = chooseBookingToSettle(bookings, payment.transactedAt);
  // A name match only ever stands on the amount agreeing — re-checked against
  // the fresh read, so an earlier payment in this same run can't shift it.
  const target = matchedVia === "name" && found?.amountPence !== payment.amountPence ? null : found;

  if (!target) {
    // A name match that didn't hold up isn't attribution — it goes to the queue
    // unclaimed, where the name still pre-selects them for a one-tap confirm.
    return { kind: "noSession", clientId: matchedVia === "name" ? undefined : result.clientId };
  }
  return { kind: "matched", clientId: result.clientId, target, matchedVia };
}

async function settleBooking(target: PayableBookingRow, payment: BankPayment, matchedVia: MatchedVia) {
  await prisma.booking.update({
    where: { id: target.id },
    data: {
      paid: true,
      paidAt: payment.transactedAt,
      // A sliding-scale session has no recorded amount until now — what they
      // actually sent is the honest figure, so fill it in. A session that
      // already has one keeps it: the amount agreed isn't ours to overwrite
      // from a transfer that might be part payment or cover something else.
      amountPence: target.amountPence ?? payment.amountPence,
      paymentNote:
        matchedVia === "payer"
          ? `Bank transfer ${fmtDayLong(payment.transactedAt)} · from remembered payer ${payment.counterParty || "—"}`
          : matchedVia === "name"
            ? `Bank transfer ${fmtDayLong(payment.transactedAt)} · matched on name and amount (${payment.counterParty || "—"})`
            : `Bank transfer ${fmtDayLong(payment.transactedAt)} · ref ${payment.reference || "—"}`,
    },
  });
}

/**
 * The name-and-amount fallback. Only clients whose name fits are looked at, and
 * their sessions are read fresh, so a payment earlier in the same run that
 * settled one of them is already reflected.
 */
async function matchOnNameAndAmount(payment: BankPayment, clients: Array<{ id: string; name: string }>) {
  // Cheap pre-filter: the same whole-name rule, one client at a time, so only
  // clients who could possibly fit have their sessions read.
  const fits = clients.filter((c) => suggestClientByName(payment.counterParty, [{ clientId: c.id, name: c.name }]));
  if (!fits.length) return { status: "none" as const };
  const bookings = await prisma.booking.findMany({
    where: { clientId: { in: fits.map((c) => c.id) } },
    select: { id: true, clientId: true, startsAt: true, paid: true, amountPence: true, status: true },
  });
  return matchNameAndAmount(
    payment.counterParty,
    payment.amountPence,
    payment.transactedAt,
    fits.map((c) => ({ clientId: c.id, name: c.name, bookings: bookings.filter((b) => b.clientId === c.id) })),
  );
}

async function recordTransaction(
  payment: BankPayment,
  extra: { status: string; clientId?: string; bookingId?: string; matchedVia?: MatchedVia },
) {
  await prisma.bankTransaction.upsert({
    where: { feedItemUid: payment.feedItemUid },
    // Already recorded by a concurrent run — leave it exactly as it is rather
    // than re-applying, which is what keeps this whole sync idempotent.
    update: {},
    create: {
      feedItemUid: payment.feedItemUid,
      transactedAt: payment.transactedAt,
      amountPence: payment.amountPence,
      reference: payment.reference,
      counterParty: payment.counterParty,
      ...extra,
    },
  });
}

/** Tell Phoenix what landed. Non-fatal — the payments are already recorded. */
async function notify(
  applied: Array<{ payment: BankPayment; clientName: string; whenLabel: string; matchedVia: MatchedVia }>,
  needsAttention: BankPayment[],
  autoMarked: boolean,
) {
  const to = process.env.ALLOWED_EMAIL;
  if (!to) return;

  const lines: string[] = [];
  if (applied.length) {
    lines.push(autoMarked ? "Payments received and marked paid:" : "Payments received (waiting for you to apply):", "");
    for (const a of applied) {
      const via =
        a.matchedVia === "payer"
          ? " · matched by remembered payer, not reference"
          : a.matchedVia === "name"
            ? ` · matched on name and amount (${a.payment.counterParty || "—"}), no reference — worth a glance`
            : "";
      lines.push(`  ${a.clientName} — ${formatPence(a.payment.amountPence)} · session ${a.whenLabel}${via}`);
    }
  }
  if (needsAttention.length) {
    if (lines.length) lines.push("");
    lines.push("Payments I couldn't match to anyone:", "");
    for (const p of needsAttention) {
      lines.push(
        `  ${formatPence(p.amountPence)} from ${p.counterParty || "unknown"} · ref "${p.reference || "none given"}" · ${fmtDayLong(p.transactedAt)}`,
      );
    }
    lines.push("", "You can assign these from Settings › Payments.");
  }

  try {
    await sendEmail(
      to,
      applied.length
        ? `${applied.length} payment${applied.length === 1 ? "" : "s"} received`
        : `${needsAttention.length} unmatched payment${needsAttention.length === 1 ? "" : "s"}`,
      lines.join("\n"),
    );
  } catch (err) {
    console.error("Couldn't send the payment notification email", err);
  }
}
