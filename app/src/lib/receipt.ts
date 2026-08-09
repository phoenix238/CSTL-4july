import { prisma } from "@/lib/db";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong } from "@/lib/time";
import { sendReceipt } from "@/lib/portalNotify";

/**
 * Build and send a client's receipt.
 *
 * Shared by the client's own "email me a receipt" button and Phoenix's from the
 * profile, so both produce the same document — a receipt that differs depending
 * on who pressed the button would be worse than no receipt at all.
 *
 * Sending is always triggered by an explicit ask — nothing goes out just because
 * a session gets marked paid, since plenty of clients never want one and an
 * unrequested receipt for a donation-based session reads oddly. The one
 * exception: a client who asks *before* anything's confirmed paid has their
 * request remembered (`requestReceipt` below) and it goes out the moment a
 * payment lands, so they don't have to come back and ask again.
 */
export class NoReceiptError extends Error {}
/** No email on the client's record to send to. */
export class NoEmailError extends NoReceiptError {}
/** Nothing marked paid yet — distinct from NoReceiptError so callers can queue instead of failing. */
export class NothingPaidError extends NoReceiptError {}

export async function sendClientReceipt(clientId: string): Promise<{ sentTo: string; count: number }> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (!client.email) {
    throw new NoEmailError("There's no email address on this record to send a receipt to.");
  }

  const paid = await prisma.booking.findMany({
    where: { clientId, paid: true, status: { not: "cancelled" } },
    orderBy: { startsAt: "asc" },
  });
  if (!paid.length) {
    throw new NothingPaidError("There aren't any sessions marked as paid to receipt yet.");
  }

  const { sent } = await sendReceipt({
    clientName: client.name,
    clientEmail: client.email,
    lines: paid.map((b) => ({
      whenLabel: fmtDayLong(b.startsAt),
      clinicLabel: CLINIC_LABEL[b.clinic as Clinic],
      amountPence: b.amountPence,
    })),
    totalPence: paid.reduce((sum, b) => sum + (b.amountPence ?? 0), 0),
    unpricedCount: paid.filter((b) => b.amountPence == null).length,
  });
  if (!sent) {
    throw new NoReceiptError("We couldn't get that email out just now — please try again shortly.");
  }

  return { sentTo: client.email, count: paid.length };
}

/**
 * A client (or Phoenix) asking for a receipt. Sends right away if there's
 * something to receipt; otherwise remembers the request on the client record
 * so `sendPendingReceiptIfAny` can send it unattended once a payment lands —
 * the same "email me a receipt" ask, just fulfilled later.
 */
export async function requestReceipt(
  clientId: string,
): Promise<{ sentTo: string; count: number; pending?: false } | { pending: true }> {
  try {
    const result = await sendClientReceipt(clientId);
    // Clear any earlier pending ask now that a receipt has actually gone out —
    // otherwise the next payment would trigger a second, unwanted send.
    await prisma.client.update({ where: { id: clientId }, data: { receiptPending: false } });
    return result;
  } catch (err) {
    if (err instanceof NothingPaidError) {
      await prisma.client.update({ where: { id: clientId }, data: { receiptPending: true } });
      return { pending: true };
    }
    throw err;
  }
}

/**
 * Call this wherever a booking gets marked paid. Fulfils a receipt a client
 * already asked for while nothing was paid yet — a no-op for everyone else.
 */
export async function sendPendingReceiptIfAny(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { receiptPending: true } });
  if (!client?.receiptPending) return;

  try {
    await sendClientReceipt(clientId);
    await prisma.client.update({ where: { id: clientId }, data: { receiptPending: false } });
  } catch (err) {
    // Still nothing to receipt, no email on file, or the send failed — leave the
    // flag set and try again next time this client's payment status changes.
    if (!(err instanceof NoReceiptError)) console.error("Couldn't send the pending receipt", err);
  }
}
