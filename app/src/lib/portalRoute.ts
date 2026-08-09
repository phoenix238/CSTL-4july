import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { loadPortalClient } from "@/lib/portalData";
import { SlotTakenError } from "@/lib/booking/slots";

/**
 * The portal's equivalent of `guarded` — resolves the URL token to a client and
 * hands the handler that client, or refuses.
 *
 * Errors are deliberately opaque here. These routes face the open internet with
 * no session behind them, so a bad token gets one flat "link isn't valid"
 * regardless of *why*, and an internal failure never leaks its message the way
 * the signed-in `guarded` wrapper is happy to.
 */
export function portalRoute<C extends { params: Promise<{ token: string }> }>(
  handler: (
    req: Request,
    client: { id: string; name: string; email: string; clinic: string; portalToken: string },
  ) => Promise<NextResponse | Response>,
) {
  return async (req: Request, ctx: C) => {
    try {
      const settings = await getSettings();
      if (!settings.portalEnabled) {
        return NextResponse.json({ error: "Client pages are currently unavailable." }, { status: 403 });
      }
      const { token } = await ctx.params;
      const client = await loadPortalClient(token);
      if (!client) {
        return NextResponse.json(
          { error: "This link isn't valid any more — please ask Phoenix for a new one." },
          { status: 404 },
        );
      }
      return await handler(req, client);
    } catch (err) {
      // A slot going while they were deciding is ordinary, not a fault — it gets
      // its own status and its own real message so the UI can say "pick another".
      if (err instanceof SlotTakenError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      // A rule they can act on — say so plainly rather than hiding it behind a 500.
      if (err instanceof PortalRuleError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      // Anything genuinely unexpected: log it, tell them nothing specific.
      console.error(err);
      return NextResponse.json(
        { error: "Something went wrong on our end — please try again, or message Phoenix directly." },
        { status: 500 },
      );
    }
  };
}

/**
 * A rule the client broke that they can actually do something about — booking
 * a session inside the notice window, say. Surfaced verbatim, unlike a 500.
 */
export class PortalRuleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PortalRuleError";
    this.status = status;
  }
}
