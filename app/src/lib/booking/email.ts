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

/** Preview placeholder shown before the real per-client intake link is known; swapped server-side. */
export const INTAKE_SENTINEL = "(your personal intake link — added when you send)";

/**
 * What the confirmation email contains:
 *  - returning client → just the calendar invite (sent by Google Calendar itself);
 *    the email is a short confirmation.
 *  - new client (first email only) → location template with the access note,
 *    the intake-form link, and optionally payment details.
 *
 * Pure — also runs in the browser for the live preview in the booking panel.
 */
export function composeBookingEmail(
  client: { name: string; welcomeSent: boolean },
  clinic: Clinic,
  whenLabel: string,
  sendPayment: boolean,
  settings: EmailSettings,
  intakeUrl: string = INTAKE_SENTINEL,
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
    .join(settings.accessNote);
  body += `\n\nIntake form: ${intakeUrl}`;
  const includes = [
    "Google Calendar invite attached",
    "Link to the CSTL intake form",
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
