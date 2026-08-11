import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { composeBookingEmail } from "@/lib/booking/email";
import { composeReviewEmail } from "@/lib/booking/review";
import { composePaymentReminder } from "@/lib/payments/unpaid";
import { confirmToClient, sendReceipt } from "@/lib/portalNotify";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { intakeUrl } from "@/lib/intake";
import { portalUrl } from "@/lib/portal";

export type TestEmailType = "first" | "returning" | "cancellation" | "receipt" | "reminder" | "review";

/**
 * Send yourself the exact email a client would get, composed against your real
 * settings with a sample client — so you can read each one without booking a
 * real person. Always sent to ALLOWED_EMAIL (you), never anywhere else.
 */
export const POST = guarded(async (req: Request) => {
  const to = process.env.ALLOWED_EMAIL;
  if (!to) return NextResponse.json({ error: "No ALLOWED_EMAIL is set to send the test to." }, { status: 400 });

  const { type, clinic: clinicIn } = (await req.json().catch(() => ({}))) as {
    type?: TestEmailType;
    clinic?: Clinic;
  };
  const clinic: Clinic = clinicIn === "waterloo" ? "waterloo" : "bethnal";
  const settings = await getSettings();

  const clientName = "Maya Sample";
  const whenLabel = "Fri 14 Aug · 12:15";
  const paymentRef = "MAYA-4K2";
  const links = {
    intakeLink: intakeUrl(settings, "sample-token"),
    portalLink: portalUrl(settings, "sample-token"),
    paymentRef,
  };

  switch (type) {
    case "first":
    case "returning": {
      const email = composeBookingEmail(
        { name: clientName, welcomeSent: type === "returning" },
        clinic,
        whenLabel,
        true,
        settings,
        links,
      );
      await sendEmail(to, `[Test] ${email.subject}`, email.body);
      break;
    }
    case "cancellation": {
      // The real portal cancellation email, addressed to you.
      await confirmToClient({
        action: "cancelled",
        clientName,
        clientEmail: to,
        clinic,
        whenLabel,
        goodwillPence: settings.lateCancelGoodwillPence,
        paymentRef,
        portalLink: links.portalLink,
      });
      break;
    }
    case "receipt": {
      await sendReceipt({
        clientName,
        clientEmail: to,
        lines: [{ whenLabel, clinicLabel: CLINIC_LABEL[clinic], amountPence: 4000 }],
        totalPence: 4000,
        unpricedCount: 0,
      });
      break;
    }
    case "reminder": {
      const { subject, body } = composePaymentReminder(settings, {
        clientName,
        whenLabel,
        clinic,
        paymentRef,
        portalLink: links.portalLink,
      });
      await sendEmail(to, `[Test] ${subject}`, body);
      break;
    }
    case "review": {
      const { subject, body } = composeReviewEmail(clientName, clinic, settings, `${settings.appUrl}/preferences/sample-token`);
      await sendEmail(to, `[Test] ${subject}`, body);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown email type" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, sentTo: to });
});
