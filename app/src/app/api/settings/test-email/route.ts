import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getSettings } from "@/lib/db";
import { parseDataUrl } from "@/lib/google/mime";
import { sendEmail } from "@/lib/google/gmail";
import { composeBookingEmail, resolveClinicPhoto, resolveSignOff } from "@/lib/booking/email";
import { composeReviewEmail } from "@/lib/booking/review";
import { composePaymentReminder } from "@/lib/payments/unpaid";
import { composeSessionReminder } from "@/lib/reminders/sessionReminders";
import { resolveClientCopy } from "@/lib/clientCopy";
import { confirmToClient, sendReceipt } from "@/lib/portalNotify";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { intakeUrl } from "@/lib/intake";
import { portalUrl } from "@/lib/portal";
import { sessionLocation } from "@/lib/calendarLinks";
import { appBaseUrl } from "@/lib/appUrl";
import { fmtDayLong, fmtTime, londonAddDays, londonTime, londonYMD } from "@/lib/time";

export type TestEmailType =
  | "first"
  | "deposit-welcome"
  | "deposit-refund"
  | "deposit-late"
  | "deposit-reminder"
  | "returning"
  | "cancellation"
  | "receipt"
  | "reminder"
  | "session-reminder"
  | "review";

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
  const clinic: Clinic = clinicIn === "waterloo" && !type?.startsWith("deposit-") ? "waterloo" : "bethnal";
  const settings = await getSettings();

  const clientName = "Maya Sample";
  // A real (made-up) date two weeks out, rather than a hardcoded label, so the
  // add-to-calendar links below point at an actual instant — the same as the
  // ones a client's real confirmation email carries.
  const { y, m, d } = londonYMD(londonAddDays(new Date(), 14));
  const testStart = londonTime(y, m, d, 12, 15);
  const whenLabel = `${fmtDayLong(testStart)} · ${fmtTime(testStart)}`;
  const paymentRef = "MAYA-4K2";
  const address = clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
  const location = sessionLocation(clinic, address);
  const portalLink = portalUrl(settings, "sample-token");
  const links = {
    intakeLink: intakeUrl(settings, "sample-token"),
    portalLink,
    paymentRef,
    // A real, working add-to-calendar link — same as a client's actual
    // confirmation email — so this preview shows exactly what they'd see. It
    // goes through a query-param-driven sample route since there's no real
    // booking here for the client-facing .ics route to look up.
    calendarIcsUrl: `${appBaseUrl(settings)}/api/public/sample-ics?start=${encodeURIComponent(testStart.toISOString())}&location=${encodeURIComponent(location)}`,
  };

  switch (type) {
    case "deposit-welcome":
    case "first":
    case "returning": {
      const email = composeBookingEmail(
        { name: clientName, welcomeSent: type === "returning" },
        clinic,
        whenLabel,
        true,
        settings,
        links,
        { depositPaid: type === "deposit-welcome" },
      );
      const photo = parseDataUrl(resolveClinicPhoto(clinic, settings));
      const attachments = photo
        ? [{ filename: `${clinic === "waterloo" ? "waterloo" : "bethnal-green"}-entrance.jpg`, ...photo, inline: true }]
        : undefined;
      await sendEmail(to, `[Test] ${email.subject}`, email.body, undefined, attachments, { links: [
        { url: links.portalLink, label: "Manage or cancel booking" },
        { url: links.intakeLink, label: "Click here for your intake form" },
        { url: links.calendarIcsUrl, label: "Add to calendar" },
      ] });
      break;
    }
    case "deposit-refund":
    case "deposit-late":
    case "cancellation": {
      // The real portal cancellation email, addressed to you.
      const { sent } = await confirmToClient({
        action: "cancelled",
        clientName,
        clientEmail: to,
        clinic,
        whenLabel,
        goodwillPence: type === "cancellation" ? settings.lateCancelGoodwillPence : undefined,
        depositCancellation: type === "deposit-refund" ? "refund_requested" : type === "deposit-late" ? "late_review" : undefined,
        paymentRef,
        portalLink: links.portalLink,
      });
      if (!sent) return NextResponse.json({ error: "The cancellation email could not be sent." }, { status: 502 });
      break;
    }
    case "receipt": {
      const { sent } = await sendReceipt({
        clientName,
        clientEmail: to,
        clientRef: paymentRef,
        // A made-up number rather than issueReceiptNumber() — a test send shouldn't burn a real one.
        receiptNumber: "RCT-SAMPLE",
        lines: [{ whenLabel, clinic, clinicLabel: CLINIC_LABEL[clinic], amountPence: 4000, paymentNote: "Cash" }],
        totalPence: 4000,
        unpricedCount: 0,
      });
      if (!sent) return NextResponse.json({ error: "The receipt email could not be sent." }, { status: 502 });
      break;
    }
    case "deposit-reminder":
    case "reminder": {
      const { subject, body } = composePaymentReminder(settings, {
        clientName,
        whenLabel,
        clinic,
        paymentRef,
        portalLink: links.portalLink,
        deposit: type === "deposit-reminder" ? { amountPence: 4500, depositPence: 1500 } : undefined,
      });
      await sendEmail(to, `[Test] ${subject}`, body, undefined, undefined, {
        links: [{ url: links.portalLink, label: "Click here for your booking page" }],
      });
      break;
    }
    case "session-reminder": {
      // The daily reminder sweep's own email — same composer, same sample links
      // as the "first"/"returning" cases above, so this reads exactly like a real
      // reminder for a session a client opted into.
      const copy = resolveClientCopy(settings.clientCopy);
      const signOff = resolveSignOff(settings);
      const { subject, body } = composeSessionReminder(
        { clientName, whenLabel, clinic, location, icsUrl: links.calendarIcsUrl, portalLink: links.portalLink },
        copy,
        signOff,
      );
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
