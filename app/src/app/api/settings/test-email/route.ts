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
import { googleCalendarUrl, sessionLocation } from "@/lib/calendarLinks";
import { appBaseUrl } from "@/lib/appUrl";
import { fmtDayLong, fmtTime, londonAddDays, londonTime, londonYMD } from "@/lib/time";

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
    // Real, working links — same as a client's actual confirmation email —
    // so this preview shows exactly what they'd see, add-to-calendar buttons
    // included. The .ics goes through a query-param-driven sample route since
    // there's no real booking here for the client-facing one to look up.
    calendarGoogleUrl: googleCalendarUrl({
      uid: "sample",
      start: testStart,
      location,
      description: `Craniosacral therapy with Phoenix Tanner. Manage this session: ${portalLink}`,
    }),
    calendarIcsUrl: `${appBaseUrl(settings)}/api/public/sample-ics?start=${encodeURIComponent(testStart.toISOString())}&location=${encodeURIComponent(location)}`,
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
