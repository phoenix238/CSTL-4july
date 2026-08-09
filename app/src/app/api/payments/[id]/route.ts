import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { chooseBookingToSettle } from "@/lib/payments/match";
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

  const bookings = await prisma.booking.findMany({
    where: { clientId },
    select: { id: true, startsAt: true, paid: true, amountPence: true, status: true },
  });
  const target = chooseBookingToSettle(bookings);
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
    data: { status: "matched", clientId, bookingId: target.id },
  });
  await sendPendingReceiptIfAny(clientId);

  return NextResponse.json({ ok: true, status: "matched", bookingId: target.id });
});
