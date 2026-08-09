import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

/**
 * Record what happened with the money on one booking.
 *
 * Every field is optional and only applied when present, so the profile's
 * one-tap "mark paid" doesn't have to send — or accidentally clear — the
 * sliding-scale amount or the goodwill state alongside it.
 *
 * Body: { paid?, amountPence?, paymentNote?, goodwillSettled?, goodwillWaived?, goodwillPence? }
 */
export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    paid?: boolean;
    amountPence?: number | null;
    paymentNote?: string;
    goodwillSettled?: boolean;
    goodwillWaived?: boolean;
    goodwillPence?: number;
  };

  const data: Record<string, unknown> = {};

  if (typeof body.paid === "boolean") {
    data.paid = body.paid;
    // Un-ticking clears the timestamp too, so a mis-tap doesn't leave a paid date
    // behind on a session that isn't paid.
    data.paidAt = body.paid ? new Date() : null;
  }
  if (body.amountPence !== undefined) {
    if (body.amountPence !== null && (!Number.isFinite(body.amountPence) || body.amountPence < 0)) {
      throw new Error("Amount must be a positive number of pence.");
    }
    data.amountPence = body.amountPence === null ? null : Math.round(body.amountPence);
  }
  if (typeof body.paymentNote === "string") data.paymentNote = body.paymentNote.slice(0, 500);
  if (typeof body.goodwillSettled === "boolean") data.goodwillSettled = body.goodwillSettled;
  if (typeof body.goodwillWaived === "boolean") data.goodwillWaived = body.goodwillWaived;
  if (typeof body.goodwillPence === "number") {
    if (!Number.isFinite(body.goodwillPence) || body.goodwillPence < 0) {
      throw new Error("Contribution must be a positive number of pence.");
    }
    data.goodwillPence = Math.round(body.goodwillPence);
  }

  if (!Object.keys(data).length) throw new Error("Nothing to update.");

  const booking = await prisma.booking.update({ where: { id }, data });
  return NextResponse.json({
    id: booking.id,
    paid: booking.paid,
    amountPence: booking.amountPence,
    goodwillPence: booking.goodwillPence,
    goodwillSettled: booking.goodwillSettled,
    goodwillWaived: booking.goodwillWaived,
  });
});
