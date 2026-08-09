import { NextResponse } from "next/server";
import { prisma, getSettings } from "@/lib/db";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong } from "@/lib/time";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { sendReceipt } from "@/lib/portalNotify";

/** Email the client a receipt for everything they've paid for. */
export const POST = portalRoute(async (_req, client) => {
  const settings = await getSettings();
  if (!settings.portalReceipts) {
    throw new PortalRuleError("Receipts aren't available here — please message Phoenix and he'll send you one.", 403);
  }
  if (!client.email) {
    throw new PortalRuleError(
      "There's no email address on your record to send a receipt to — please message Phoenix.",
    );
  }

  const paid = await prisma.booking.findMany({
    where: { clientId: client.id, paid: true, status: { not: "cancelled" } },
    orderBy: { startsAt: "asc" },
  });
  if (!paid.length) {
    throw new PortalRuleError("There aren't any paid sessions on your record to receipt yet.");
  }

  const lines = paid.map((b) => ({
    whenLabel: fmtDayLong(b.startsAt),
    clinicLabel: CLINIC_LABEL[b.clinic as Clinic],
    amountPence: b.amountPence,
  }));
  const totalPence = paid.reduce((sum, b) => sum + (b.amountPence ?? 0), 0);
  const unpricedCount = paid.filter((b) => b.amountPence == null).length;

  const { sent } = await sendReceipt({
    clientName: client.name,
    clientEmail: client.email,
    lines,
    totalPence,
    unpricedCount,
  });
  if (!sent) {
    throw new PortalRuleError(
      "We couldn't get that email out just now — please try again shortly, or message Phoenix.",
      502,
    );
  }

  return NextResponse.json({ sentTo: client.email, count: paid.length });
});
