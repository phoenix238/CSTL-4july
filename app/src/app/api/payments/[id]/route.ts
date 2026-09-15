import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { chooseBookingToSettle, normalisePayerName, normaliseRef } from "@/lib/payments/match";
import { sendPendingReceiptIfAny } from "@/lib/receipt";
import { fmtDayLong } from "@/lib/time";

/**
 * Resolve a payment the matcher couldn't place: assign it to a client, or set it
 * aside. Body: { clientId } to assign, or { ignore: true } to file it away.
 *
 * Assigning settles the same session the automatic path would have chosen, so a
 * payment sorted out by hand lands exactly where it would have landed on its own.
 */
export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { clientId, ignore } = (await req.json()) as { clientId?: string; ignore?: boolean };

  const tx = await prisma.bankTransaction.findUniqueOrThrow({ where: { id } });

  if (ignore) {
    await prisma.bankTransaction.update({ where: { id }, data: { status: "ignored", clientId: null, bookingId: null } });
    return NextResponse.json({ ok: true, status: "ignored" });
  }

  if (!clientId) throw new Error("Pick a client to assign this payment to.");
  if (tx.status === "matched") throw new Error("That payment has already been applied.");

  // A human has now vouched for this payment belonging to this client — remember
  // what it looked like, for next time.
  if (tx.counterParty || tx.reference) {
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { knownPayerNames: true, knownReferences: true, paymentRef: true },
    });
    const remember: { knownPayerNames?: { push: string }; knownReferences?: { push: string } } = {};

    // The bank name: remembered as an automatic match next time (matchKnownPayer)
    // — exact string only, so it stays as safe as a reference. A slightly
    // different name on a future transfer just falls back to this same queue
    // rather than being guessed.
    if (tx.counterParty && !client.knownPayerNames.some((n) => normalisePayerName(n) === normalisePayerName(tx.counterParty))) {
      remember.knownPayerNames = { push: tx.counterParty };
    }

    // The reference text they actually typed, when it isn't their issued
    // reference (which the automatic matcher already recognises on its own).
    // People tend to reuse whatever they typed the first time, but free text is
    // weaker evidence than a bank name, so this only ever pre-fills the manual
    // queue for a one-tap confirm (suggestClientByKnownReference) — never a
    // definite, automatic match.
    if (
      tx.reference &&
      normaliseRef(tx.reference) !== normaliseRef(client.paymentRef) &&
      !client.knownReferences.some((r) => normaliseRef(r) === normaliseRef(tx.reference))
    ) {
      remember.knownReferences = { push: tx.reference };
    }

    if (Object.keys(remember).length) {
      await prisma.client.update({ where: { id: clientId }, data: remember });
    }
  }

  const bookings = await prisma.booking.findMany({
    where: { clientId },
    select: { id: true, startsAt: true, paid: true, amountPence: true, status: true },
  });
  // A hand-assignment: the person has already decided this payment is theirs, so
  // don't apply the ±window that guards the automatic path — place it on the best
  // session whatever its age, dated from the transfer.
  const target = chooseBookingToSettle(bookings, tx.transactedAt, Infinity);
  if (!target) {
    // Recorded against them even with nothing to settle — better a payment
    // attributed to the right person than one left looking anonymous.
    await prisma.bankTransaction.update({ where: { id }, data: { clientId, status: "unmatched" } });
    return NextResponse.json({ ok: true, status: "unmatched", note: "No unpaid session to put it against." });
  }

  await prisma.booking.update({
    where: { id: target.id },
    data: {
      paid: true,
      paidAt: tx.transactedAt,
      amountPence: target.amountPence ?? tx.amountPence,
      paymentNote: `Bank transfer ${fmtDayLong(tx.transactedAt)} · ref ${tx.reference || "—"}`,
    },
  });
  await prisma.bankTransaction.update({
    where: { id },
    data: { status: "matched", clientId, bookingId: target.id, matchedVia: "manual" },
  });
  await sendPendingReceiptIfAny(clientId);

  return NextResponse.json({ ok: true, status: "matched", bookingId: target.id });
});
