import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { findClientByEmail } from "@/lib/clients";
import { getPortalIdentity, portalUrl } from "@/lib/portal";
import { sendEmail } from "@/lib/google/gmail";
import { resolveSignOff } from "@/lib/booking/email";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { isValidEmail } from "@/lib/validate";

/**
 * "Email me my page link." A returning client gets their own booking page sent
 * to the address it's filed under — the page is never opened for whoever typed
 * the email, so knowing someone's address doesn't open their record.
 *
 * The response is deliberately the same whether or not the email is on file, so
 * this can't be used to discover who is a client. Rate-limited like a booking.
 */
export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const clean = (email ?? "").trim();

  // A malformed address gets the same bland answer — no signal either way.
  if (!clean || !isValidEmail(clean)) {
    return NextResponse.json({ ok: true });
  }

  try {
    await assertBookingAllowed(req, clean);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  // Everything past here is best-effort and silent: a match sends the link, a
  // miss does nothing, and both return the same thing.
  try {
    const client = await findClientByEmail(clean);
    if (client) {
      const settings = await getSettings();
      const { token } = await getPortalIdentity(client.id);
      const link = portalUrl(settings, token);
      if (link) {
        const first = client.name.split(" ")[0] || "there";
        const body = [
          `Hi ${first},`,
          "",
          "Here's your own booking page — you can book, move or cancel a session from here any time:",
          link,
          "",
          "No login, just keep the link — it's worth bookmarking.",
          "",
          ...resolveSignOff(settings).split("\n"),
        ].join("\n");
        await sendEmail(clean, "Your booking page", body);
      }
    }
  } catch (err) {
    console.error("send-link failed", err);
  }

  return NextResponse.json({ ok: true });
}
