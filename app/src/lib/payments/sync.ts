import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { formatPence } from "@/lib/account";
import { fmtDayLong } from "@/lib/time";
import { fetchIncomingPayments, type BankPayment } from "@/lib/starling";
import { sendPendingReceiptIfAny } from "@/lib/receipt";
import { chooseBookingToSettle, matchReference, type RefCandidate } from "./match";

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
  accountLabel?: string;
}

export async function syncBankPayments({ force = false }: { force?: boolean } = {}): Promise<SyncSummary> {
  const settings = await getSettings();
  if (!settings.starlingEnabled && !force) {
    return { newCount: 0, matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0 };
  }

  // Re-read a day behind the watermark: a transaction can settle after others
  // that came later, so an exact resume point would step over it. Re-reading is
  // free because the feedItemUid uniqueness makes reprocessing a no-op.
  const lookbackMs = settings.starlingLookbackDays * 86_400_000;
  const since = settings.starlingLastSyncAt
    ? new Date(settings.starlingLastSyncAt.getTime() - 86_400_000)
    : new Date(Date.now() - lookbackMs);

  const payments = await fetchIncomingPayments(since);
  if (!payments.length) {
    await prisma.appSettings.update({ where: { id: 1 }, data: { starlingLastSyncAt: new Date() } });
    return { newCount: 0, matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0 };
  }

  const seen = await prisma.bankTransaction.findMany({
    where: { feedItemUid: { in: payments.map((p) => p.feedItemUid) } },
    select: { feedItemUid: true },
  });
  const known = new Set(seen.map((s) => s.feedItemUid));
  const fresh = payments.filter((p) => !known.has(p.feedItemUid));

  const clients = await prisma.client.findMany({
    where: { paymentRef: { not: "" } },
    select: { id: true, name: true, paymentRef: true },
  });
  const candidates: RefCandidate[] = clients.map((c) => ({ clientId: c.id, paymentRef: c.paymentRef }));
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));

  const summary: SyncSummary = { newCount: fresh.length, matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0 };
  const applied: Array<{ payment: BankPayment; clientName: string; whenLabel: string }> = [];
  const needsAttention: BankPayment[] = [];

  for (const payment of fresh) {
    const result = matchReference(payment.reference, candidates);

    if (result.status === "none") {
      summary.unmatchedCount++;
      needsAttention.push(payment);
      await recordTransaction(payment, { status: "unmatched" });
      continue;
    }
    if (result.status === "ambiguous") {
      summary.ambiguousCount++;
      needsAttention.push(payment);
      await recordTransaction(payment, { status: "ambiguous" });
      continue;
    }

    const bookings = await prisma.booking.findMany({
      where: { clientId: result.clientId },
      select: { id: true, startsAt: true, paid: true, amountPence: true, status: true },
    });
    const target = chooseBookingToSettle(bookings);

    if (!target) {
      // Their reference, but nothing outstanding to put it against — a prepayment
      // for a session not yet booked, most likely. Recorded against the client so
      // it isn't lost, but no session is invented for it.
      summary.unmatchedCount++;
      needsAttention.push(payment);
      await recordTransaction(payment, { status: "unmatched", clientId: result.clientId });
      continue;
    }

    if (settings.starlingAutoMark) {
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
          paymentNote: `Bank transfer ${fmtDayLong(payment.transactedAt)} · ref ${payment.reference || "—"}`,
        },
      });
      await sendPendingReceiptIfAny(result.clientId);
    }
    await recordTransaction(payment, {
      status: "matched",
      clientId: result.clientId,
      bookingId: target.id,
    });
    summary.matchedCount++;
    applied.push({
      payment,
      clientName: nameOf.get(result.clientId) ?? "A client",
      whenLabel: fmtDayLong(target.startsAt),
    });
  }

  await prisma.appSettings.update({ where: { id: 1 }, data: { starlingLastSyncAt: new Date() } });

  if (settings.starlingNotifyEmail && (applied.length || needsAttention.length)) {
    await notify(applied, needsAttention, settings.starlingAutoMark);
  }
  return summary;
}

async function recordTransaction(
  payment: BankPayment,
  extra: { status: string; clientId?: string; bookingId?: string },
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
  applied: Array<{ payment: BankPayment; clientName: string; whenLabel: string }>,
  needsAttention: BankPayment[],
  autoMarked: boolean,
) {
  const to = process.env.ALLOWED_EMAIL;
  if (!to) return;

  const lines: string[] = [];
  if (applied.length) {
    lines.push(autoMarked ? "Payments received and marked paid:" : "Payments received (waiting for you to apply):", "");
    for (const a of applied) {
      lines.push(`  ${a.clientName} — ${formatPence(a.payment.amountPence)} · session ${a.whenLabel}`);
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
