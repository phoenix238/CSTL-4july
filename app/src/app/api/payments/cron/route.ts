import { NextResponse } from "next/server";
import { syncBankPayments } from "@/lib/payments/sync";

/**
 * Scheduled payment check.
 *
 * Not behind the normal sign-in guard, because a scheduler has no session — so
 * it carries its own shared secret instead. Without CRON_SECRET set the route
 * refuses outright rather than falling open: an unauthenticated endpoint that
 * reads the bank feed is not something to leave running by accident.
 *
 * Vercel's scheduler sends `Authorization: Bearer <CRON_SECRET>`. Add to
 * vercel.json:  { "crons": [{ "path": "/api/payments/cron", "schedule": "0 * * * *" }] }
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncBankPayments());
  } catch (err) {
    console.error("Scheduled payment sync failed", err);
    return NextResponse.json({ error: "Payment sync failed" }, { status: 500 });
  }
}
