import { NextResponse } from "next/server";
import { completeDeposit } from "@/lib/booking/completeDeposit";
import { sandboxStripe } from "@/lib/booking/depositCheckout";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return new NextResponse(null, { status: 400 });
  const { stripe } = sandboxStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (event.livemode) return new NextResponse(null, { status: 400 });
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await completeDeposit(event.data.object);
  }
  return NextResponse.json({ received: true });
}
