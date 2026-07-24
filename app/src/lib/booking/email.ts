import { CLINIC_LABEL, CLINIC_PRICE, type Clinic } from "./rules";

export interface ComposedEmail {
  subject: string;
  body: string;
  /** the ✓-list shown in the booking panel and confirmation screen */
  includes: string[];
}

/** The settings fields the email needs — plain shape so the browser can pass /api/settings JSON. */
export interface EmailSettings {
  emailTemplateWaterloo: string;
  emailTemplateBethnal: string;
  accessNote: string;
  paymentDetails: string;
  waterlooAddress: string;
  bethnalAddress: string;
}

/**
 * What the confirmation email contains:
 *  - returning client → just the calendar invite (sent by Google Calendar itself);
 *    the email is a short confirmation.
 *  - new client (first email only) → location template with the access note,
 *    the intake-form link, the address/map, and optionally payment details.
 *
 * The intake link is folded into this first welcome email (via the {intakeLink}
 * placeholder) so it's one message, not two — the template's "the link is below"
 * line is finally true. The standalone "Send intake form" button still exists as a
 * resend for clients who need it again. See app/src/app/api/clients/[id]/intake-email/route.ts.
 *
 * Pure — also runs in the browser for the live preview in the booking panel, where
 * the real token doesn't exist yet, so a placeholder link string is passed instead.
 */
export function composeBookingEmail(
  client: { name: string; welcomeSent: boolean },
  clinic: Clinic,
  whenLabel: string,
  sendPayment: boolean,
  settings: EmailSettings,
  /** the client's personal intake link — real URL on the server, a placeholder for preview */
  intakeLink = "(your personal intake link)",
): ComposedEmail {
  const isFirstEmail = !client.welcomeSent;
  const subject = `Your craniosacral session — ${whenLabel} · ${CLINIC_LABEL[clinic]}`;

  if (!isFirstEmail) {
    return {
      subject,
      body: `Hi ${client.name},\n\nJust confirming your next session: ${whenLabel} at ${CLINIC_LABEL[clinic]}. The calendar invite is attached to this booking.\n\nSee you soon,\nPhoenix`,
      includes: ["Google Calendar invite attached"],
    };
  }

  const template = clinic === "waterloo" ? settings.emailTemplateWaterloo : settings.emailTemplateBethnal;
  let body = template
    .split("{name}")
    .join(client.name)
    .split("{accessNote}")
    .join(settings.accessNote)
    .split("{intakeLink}")
    .join(intakeLink);
  // Guarantee the intake link is actually present: older/custom templates say
  // "the link is below" without a {intakeLink} placeholder, so append it if the
  // template didn't already position it.
  if (!template.includes("{intakeLink}")) {
    body += `\n\nYour intake form (a couple of minutes, goes straight into your confidential record):\n${intakeLink}`;
  }
  const includes = [
    "Google Calendar invite attached",
    "Intake form link",
    "Access note — stairs, no step-free access",
  ];
  const address = clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
  if (address) {
    const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    body += `\n\nLocation: ${address}\nMap: ${mapsLink}`;
    includes.push("Location & map link");
  }
  if (sendPayment) {
    body += `\n\nPayment (${CLINIC_PRICE[clinic]}):\n${settings.paymentDetails}`;
    includes.push(`Payment details — ${CLINIC_PRICE[clinic]}`);
  }
  return { subject, body, includes };
}
