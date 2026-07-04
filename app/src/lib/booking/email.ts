import type { AppSettings, Client } from "@prisma/client";
import { CLINIC_LABEL, CLINIC_PRICE, type Clinic } from "./rules";

export interface ComposedEmail {
  subject: string;
  body: string;
  /** the ✓-list shown in the booking panel and confirmation screen */
  includes: string[];
}

/**
 * What the confirmation email contains:
 *  - returning client → just the calendar invite (sent by Google Calendar itself);
 *    the email is a short confirmation.
 *  - new client (first email only) → location template with the access note,
 *    the intake-form link, and optionally payment details.
 */
export function composeBookingEmail(
  client: Pick<Client, "name" | "welcomeSent">,
  clinic: Clinic,
  whenLabel: string,
  sendPayment: boolean,
  settings: AppSettings,
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
  body += `\n\nIntake form: ${settings.intakeFormUrl}`;
  const includes = [
    "Google Calendar invite attached",
    "Link to the CSTL intake form",
    "Access note — stairs, no step-free access",
  ];
  if (sendPayment) {
    body += `\n\nPayment (${CLINIC_PRICE[clinic]}):\n${settings.paymentDetails}`;
    includes.push(`Payment details — ${CLINIC_PRICE[clinic]}`);
  }
  return { subject, body, includes };
}
