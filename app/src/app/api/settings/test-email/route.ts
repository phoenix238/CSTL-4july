import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { getSettings, getSpaces } from "@/lib/db";
import { activeSpaces } from "@/lib/spaces";
import { sendEmail } from "@/lib/google/gmail";
import { composeBookingEmail, resolveSignOff } from "@/lib/booking/email";
import { composeReviewEmail } from "@/lib/booking/review";
import { composePaymentReminder } from "@/lib/payments/unpaid";
import { composeSessionReminder } from "@/lib/reminders/sessionReminders";
import { resolveClientCopy } from "@/lib/clientCopy";
import { composeBookingPageEmail } from "@/lib/bookingPageEmail";
import { composeFirstSessionEmail } from "@/lib/reminders/firstSession";
import { composeNoShowEmail } from "@/lib/noShow";
import { practitionerIdentity } from "@/lib/practitioner";
import { confirmToClient, sendReceipt } from "@/lib/portalNotify";
import type { Clinic } from "@/lib/booking/rules";
import { intakeUrl } from "@/lib/intake";
import { portalUrl } from "@/lib/portal";
import { sessionLocation } from "@/lib/calendarLinks";
import { appBaseUrl } from "@/lib/appUrl";
import { fmtDayLong, fmtTime, londonAddDays, londonTime, londonYMD } from "@/lib/time";

export type TestEmailType =
  | "first"
  | "returning"
  | "cancellation"
  | "moved"
  | "receipt"
  | "reminder"
  | "session-reminder"
  | "review"
  | "booking-page"
  | "first-session"
  | "first-session-done"
  | "no-show";

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
  const settings = await getSettings();
  // The space picked for the sample — any open space; the first one otherwise.
  const open = activeSpaces(await getSpaces());
  const space = open.find((sp) => sp.id === clinicIn) ?? open[0];
  if (!space) return NextResponse.json({ error: "Add a space in Settings first." }, { status: 400 });
  const clinic: Clinic = space.id;

  const clientName = "Maya Sample";
  // A real (made-up) date two weeks out, rather than a hardcoded label, so the
  // add-to-calendar links below point at an actual instant — the same as the
  // ones a client's real confirmation email carries.
  const { y, m, d } = londonYMD(londonAddDays(new Date(), 14));
  const testStart = londonTime(y, m, d, 12, 15);
  const whenLabel = `${fmtDayLong(testStart)} · ${fmtTime(testStart)}`;
  const paymentRef = "MAYA-4K2";
  const location = sessionLocation(space);
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
    case "moved": {
      // The real "your session has been moved" email, addressed to you.
      await confirmToClient({
        action: "rescheduled",
        clientName,
        clientEmail: to,
        clinic,
        whenLabel,
        previousWhenLabel: `${fmtDayLong(londonAddDays(testStart, -2))} · ${fmtTime(testStart)}`,
        portalLink: links.portalLink,
      });
      break;
    }
    case "booking-page": {
      const { subject, body } = composeBookingPageEmail(settings, { clientName, link: portalLink, paymentRef });
      await sendEmail(to, `[Test] ${subject}`, body);
      break;
    }
    case "first-session":
    case "first-session-done": {
      const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
      const { subject, body } = composeFirstSessionEmail(
        {
          clientFirstName: "Maya",
          whenLabel,
          space,
          intakeDone: type === "first-session-done",
          intakeLink: links.intakeLink,
          portalLink,
          remindersLink: `${portalLink}#reminders`,
          offerReminders: !settings.remindNewClientsByDefault,
        },
        copy,
        resolveSignOff(settings),
      );
      await sendEmail(to, `[Test] ${subject}`, body);
      break;
    }
    case "no-show": {
      const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
      const { subject, body } = composeNoShowEmail(
        {
          clientFirstName: "Maya",
          whenLabel,
          clinicName: space.name,
          contributionPence: settings.lateCancelGoodwillPence,
          paymentRef,
          portalLink,
        },
        copy,
        resolveSignOff(settings),
      );
      await sendEmail(to, `[Test] ${subject}`, body);
      break;
    }
    case "receipt": {
      await sendReceipt({
        clientName,
        clientEmail: to,
        clientRef: paymentRef,
        // A made-up number rather than issueReceiptNumber() — a test send shouldn't burn a real one.
        receiptNumber: "RCT-SAMPLE",
        lines: [{ whenLabel, clinic, clinicLabel: space.name, amountPence: 4000, paymentNote: "Cash" }],
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
    case "session-reminder": {
      // The daily reminder sweep's own email — same composer, same sample links
      // as the "first"/"returning" cases above, so this reads exactly like a real
      // reminder for a session a client opted into.
      const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
      const signOff = resolveSignOff(settings);
      const { subject, body } = composeSessionReminder(
        { clientName, whenLabel, clinicName: space.name, location, icsUrl: links.calendarIcsUrl, portalLink: links.portalLink },
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
