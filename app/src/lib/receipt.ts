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
 * Sending is always an explicit action. Nothing goes out automatically when a
 * session is marked paid: plenty of clients never want one, and an unrequested
 * receipt for a donation-based session reads oddly.
 */
export class NoReceiptError extends Error {}

export async function sendClientReceipt(clientId: string): Promise<{ sentTo: string; count: number }> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (!client.email) {
    throw new NoReceiptError("There's no email address on this record to send a receipt to.");
  }

  const paid = await prisma.booking.findMany({
    where: { clientId, paid: true, status: { not: "cancelled" } },
    orderBy: { startsAt: "asc" },
  });
  if (!paid.length) {
    throw new NoReceiptError("There aren't any sessions marked as paid to receipt yet.");
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
