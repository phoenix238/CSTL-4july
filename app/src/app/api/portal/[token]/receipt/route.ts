import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { NoReceiptError, requestReceipt } from "@/lib/receipt";

/**
 * Email the client a receipt for everything they've paid for — or, if nothing's
 * confirmed paid yet, remember the ask and send it automatically once it is.
 */
export const POST = portalRoute(async (_req, client) => {
  const settings = await getSettings();
  if (!settings.portalReceipts) {
    throw new PortalRuleError("Receipts aren't available here — please message Phoenix and he'll send you one.", 403);
  }

  try {
    const result = await requestReceipt(client.id);
    return NextResponse.json(result);
  } catch (err) {
    // "No email on file" — the one case still worth saying plainly rather than
    // swallowing behind the generic 500.
    if (err instanceof NoReceiptError) throw new PortalRuleError(err.message);
    throw err;
  }
});
