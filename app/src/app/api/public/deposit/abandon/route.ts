import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { releaseExpiredDeposit, depositStripe } from "@/lib/booking/depositCheckout";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Checkout not found." }, { status: 404 });
  }
  const hold = await prisma.bookingDeposit.findUnique({ where: { id } });
  if (!hold?.stripeSessionId) return NextResponse.json({ error: "Checkout not found." }, { status: 404 });
  if (hold.state === "expired" || hold.state === "refund_requested") return NextResponse.json({ released: true });
  if (hold.state !== "holding") return NextResponse.json({ released: false });

  const { stripe } = depositStripe(hold.liveMode);
  let session;
  try {
    session = await stripe.checkout.sessions.expire(hold.stripeSessionId);
  } catch {
    // Stripe rejects expiry after a session completes. Read the current state
    // before deciding whether the client can safely start a second checkout.
    session = await stripe.checkout.sessions.retrieve(hold.stripeSessionId);
  }
  if (session.status !== "expired") return NextResponse.json({ released: false });
  await releaseExpiredDeposit(session);
  return NextResponse.json({ released: true });
}
