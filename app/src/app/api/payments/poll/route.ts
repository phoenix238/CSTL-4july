import { NextResponse } from "next/server";
import { syncBankPayments } from "@/lib/payments/sync";

/**
 * Bank check only — nothing else from the daily cron.
 *
 * Vercel's Hobby plan allows one scheduled trigger a day and it's spent on
 * `/api/payments/cron`, so a transfer could sit unmarked for up to ~24h.
 * A GitHub Actions workflow (.github/workflows/payments-poll.yml) calls this
 * every 15 minutes instead, so a payment is marked paid shortly after it
 * settles. `syncBankPayments` is idempotent (keyed on Starling's feedItemUid),
 * so running it often is safe, and it still honours the Settings switches.
 *
 * Behind CRON_SECRET, the same as the daily cron.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  try {
    return NextResponse.json(await syncBankPayments());
  } catch (err) {
    console.error("Payment poll failed", err);
    return NextResponse.json({ error: "Payment poll failed" }, { status: 500 });
  }
}
