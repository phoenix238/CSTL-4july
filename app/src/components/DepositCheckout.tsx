"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { api } from "./ui";
import { PHOENIX_CONTACT_EMAIL } from "@/lib/booking/contact";

export type DepositCheckoutSession = { id: string; clientSecret: string; publishableKey: string };
export type DepositBookingConfirmation = { whenLabel: string; emailSent: boolean; intakeUrl: string };

export function DepositCheckout({ session, onBooked }: {
  session: DepositCheckoutSession;
  onBooked: (result: DepositBookingConfirmation) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const booked = useRef(onBooked);
  booked.current = onBooked;
  const [message, setMessage] = useState("Loading secure checkout…");
  const [checking, setChecking] = useState(false);

  async function checkPayment() {
    setChecking(true);
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const result = await api<DepositBookingConfirmation & { state: string }>("/api/public/deposit/status", {
          method: "POST", body: JSON.stringify({ id: session.id }),
        });
        if (result.state === "booked") {
          booked.current(result);
          return;
        }
        if (result.state === "refund_requested") {
          setMessage("We couldn’t confirm this appointment. Stripe has been asked to return your full £15 deposit.");
          return;
        }
        if (result.state === "expired") {
          setMessage("This checkout has expired. Please go back and pick a time again.");
          return;
        }
        if (result.state === "booking_review") {
          setMessage(`Your deposit was paid. Phoenix is checking the appointment. Please email ${PHOENIX_CONTACT_EMAIL} if you need help.`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setMessage("We’re still checking your payment and appointment. Please check again before making another payment.");
    } catch {
      setMessage("We couldn’t check the booking yet. Please check again before making another payment.");
    } finally {
      setChecking(false);
    }
  }

  const check = useRef(checkPayment);
  check.current = checkPayment;

  useEffect(() => {
    let disposed = false;
    let embedded: StripeEmbeddedCheckout | undefined;
    void (async () => {
      try {
        const stripe = await loadStripe(session.publishableKey);
        if (!stripe || disposed) return;
        embedded = await stripe.createEmbeddedCheckoutPage({
          clientSecret: session.clientSecret,
          onComplete: () => {
            embedded?.unmount();
            setMessage("Checking your payment and appointment…");
            void check.current();
          },
        });
        if (disposed) embedded.destroy();
        else if (container.current) {
          embedded.mount(container.current);
          setMessage("");
        }
      } catch {
        if (!disposed) setMessage("Stripe checkout couldn’t load. Please check your connection.");
      }
    })();
    return () => {
      disposed = true;
      embedded?.destroy();
    };
  }, [session]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">The £15 deposit comes off your £30–£60 sliding-scale price. Pay the remaining £15–£45 by bank transfer.</p>
      <p className="text-sm text-muted">Cancel at least 24 hours before your appointment for a full refund. Phoenix reviews shorter-notice cancellations.</p>
      <div ref={container} />
      {message && <p role="status" className="text-sm text-muted">{message}</p>}
      <button type="button" className="text-sm text-clay-text underline" disabled={checking} onClick={() => void checkPayment()}>
        {checking ? "Checking…" : "Check payment and booking"}
      </button>
    </div>
  );
}
