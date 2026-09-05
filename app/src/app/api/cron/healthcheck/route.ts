import { NextResponse } from "next/server";
import { checkCronHealth } from "@/lib/cronHealth";

/**
 * The dead-man's switch's own endpoint. Pinged by a scheduled GitHub Actions
 * workflow (.github/workflows/cron-healthcheck.yml) every few hours — not
 * Vercel's cron, whose one daily slot on the Hobby plan is already spent on
 * `/api/payments/cron`, the thing this watches. Being on a different
 * scheduler entirely is the point: if Vercel's cron infrastructure itself is
 * what's broken, something outside it still notices.
 *
 * Behind its own secret, separate from CRON_SECRET, so a leak of one doesn't
 * expose the other.
 */
export async function GET(req: Request) {
  const secret = process.env.HEALTHCHECK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "HEALTHCHECK_SECRET is not set" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  try {
    const result = await checkCronHealth();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Cron healthcheck failed", err);
    return NextResponse.json({ error: "Healthcheck failed" }, { status: 500 });
  }
}
