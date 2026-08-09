import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { NoReceiptError, sendClientReceipt } from "@/lib/receipt";

/** Email the client a receipt for everything they've paid for. */
export const POST = portalRoute(async (_req, client) => {
  const settings = await getSettings();
  if (!settings.portalReceipts) {
    throw new PortalRuleError("Receipts aren't available here — please message Phoenix and he'll send you one.", 403);
  }

  try {
    const result = await sendClientReceipt(client.id);
    return NextResponse.json(result);
  } catch (err) {
    // "No email on file", "nothing paid yet" — things the client can act on, so
    // they're said plainly rather than swallowed by the generic 500.
    if (err instanceof NoReceiptError) throw new PortalRuleError(err.message);
    throw err;
  }
});
