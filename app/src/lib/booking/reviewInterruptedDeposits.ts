import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, fmtTime } from "@/lib/time";

/** A worker can stop after committing the booking, before finishing Calendar or Gmail. */
export async function reviewInterruptedDeposits(asOf: Date, id?: string) {
  const cutoff = new Date(asOf.getTime() - 15 * 60_000);
  const candidates = await prisma.bookingDeposit.findMany({
    where: {
      state: "confirming",
      ...(id ? { id } : {}),
      OR: [{ confirmingAt: { lte: cutoff } }, { confirmingAt: null, createdAt: { lte: cutoff } }],
    },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  let flagged = 0;
  for (const deposit of candidates) {
    const text = [
      "A paid Bethnal Green booking stopped before confirmation finished.",
      "Check the diary and sent mail before contacting the client. The CRM has reserved their appointment.",
      `${fmtDayLong(deposit.startsAt)} · ${fmtTime(deposit.startsAt)}`,
      deposit.email,
    ].join("\n");
    const claimed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.bookingDeposit.updateMany({
        where: { id: deposit.id, state: "confirming" },
        data: { state: "booking_review" },
      });
      if (!count) return false;
      const booking = deposit.bookingId
        ? await tx.booking.findUnique({ where: { id: deposit.bookingId }, select: { clientId: true } })
        : null;
      await tx.enquiry.create({
        data: { via: "ONLINE", clinic: "bethnal", name: deposit.name, clientId: booking?.clientId, text },
      });
      return true;
    });
    if (!claimed) continue;
    flagged++;
    const owner = process.env.ALLOWED_EMAIL;
    if (owner) {
      await sendEmail(owner, "Paid Bethnal Green booking needs review", text).catch(() => {
        console.error("Could not email interrupted deposit review", deposit.id);
      });
    }
  }
  return flagged;
}
