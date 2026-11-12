import { NextResponse } from "next/server";
import { getSettings, prisma } from "@/lib/db";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { completeDeposit } from "@/lib/booking/completeDeposit";
import { sandboxStripe } from "@/lib/booking/depositCheckout";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Checkout not found." }, { status: 404 });
  }
  let hold = await prisma.bookingDeposit.findUnique({ where: { id } });
  if (!hold?.stripeSessionId) return NextResponse.json({ error: "Checkout not found." }, { status: 404 });
  if (hold.state === "holding" || hold.state === "refund_required") {
    const { stripe } = sandboxStripe();
    const session = await stripe.checkout.sessions.retrieve(hold.stripeSessionId);
    await completeDeposit(session);
    hold = await prisma.bookingDeposit.findUniqueOrThrow({ where: { id } });
    if (hold.state === "holding" && session.status === "expired") {
      return NextResponse.json({ state: "expired" });
    }
  }
  if (hold.state !== "booked" || !hold.bookingId) return NextResponse.json({ state: hold.state });

  const booking = await prisma.booking.findUnique({ where: { id: hold.bookingId } });
  if (!booking || booking.status !== "confirmed") return NextResponse.json({ state: "booking_review" });

  const settings = await getSettings();
  return NextResponse.json({
    state: "booked",
    whenLabel: `${fmtDayLong(booking.startsAt)} · ${fmtTime(booking.startsAt)} · Bethnal Green`,
    intakeUrl: intakeUrl(settings, await getOrCreateIntakeToken(booking.clientId)),
    emailSent: booking.emailSent,
  });
}
