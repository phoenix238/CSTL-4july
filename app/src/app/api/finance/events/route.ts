import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { toFinanceEvent } from "@/lib/payments/financeEvents";

/**
 * Paid sessions since a date, for Honey (Phoenix's finance app) to pull into
 * the tax ledger. Read-only, money facts only — see financeEvents.ts.
 *
 * Not behind the sign-in guard, because Honey's server calls it, not a person —
 * so it carries its own shared secret. Without FINANCE_API_TOKEN set the route
 * refuses outright rather than falling open.
 *
 * GET /api/finance/events?since=<ISO>   Authorization: Bearer <FINANCE_API_TOKEN>
 */
export const dynamic = "force-dynamic";

const MAX_LOOKBACK_MS = 3 * 366 * 86_400_000;

function authorised(header: string | null, token: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  const token = process.env.FINANCE_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "FINANCE_API_TOKEN is not set" }, { status: 503 });
  }
  if (!authorised(req.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const sinceParam = new URL(req.url).searchParams.get("since");
  const parsed = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 366 * 86_400_000);
  if (Number.isNaN(parsed.getTime())) {
    return NextResponse.json({ error: "since must be an ISO date" }, { status: 400 });
  }
  const since = new Date(Math.max(parsed.getTime(), Date.now() - MAX_LOOKBACK_MS));

  const bookings = await prisma.booking.findMany({
    where: {
      paid: true,
      // Sessions marked paid before paidAt was recorded are judged by their own date.
      OR: [{ paidAt: { gte: since } }, { paidAt: null, startsAt: { gte: since } }],
    },
    select: {
      id: true,
      paidAt: true,
      startsAt: true,
      amountPence: true,
      paymentNote: true,
      clinic: true,
      client: { select: { paymentRef: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  const settled = bookings.length
    ? await prisma.bankTransaction.findMany({
        where: { bookingId: { in: bookings.map((b) => b.id) }, status: "matched" },
        select: { bookingId: true, feedItemUid: true },
      })
    : [];
  const feedFor = new Map(settled.map((t) => [t.bookingId, t.feedItemUid]));

  return NextResponse.json(
    { events: bookings.map((b) => toFinanceEvent(b, feedFor.get(b.id) ?? null)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
