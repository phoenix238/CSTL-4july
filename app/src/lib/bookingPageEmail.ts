import { applyCopy, resolveClientCopy } from "@/lib/clientCopy";
import { practitionerIdentity, type IdentitySettings } from "@/lib/practitioner";
import { resolveSignOff } from "@/lib/booking/email";

export interface BookingPageEmailSettings extends IdentitySettings {
  clientCopy?: unknown;
  emailSignOff?: string;
  bankAccountName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  bankPaymentNote?: string;
}

/**
 * The "here's your booking page" email — one wording (Settings › Messages)
 * whether you sent it from a client's profile or the client asked for their
 * link again. Pure, so the real sends and the test panel compose it the same.
 *
 * `paymentRef` adds the bank-transfer block with their reference; it's left
 * off for the self-service resend, which answers an address typed by anyone.
 */
export function composeBookingPageEmail(
  settings: BookingPageEmailSettings,
  input: { clientName: string; link: string; paymentRef?: string },
): { subject: string; body: string } {
  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
  const first = input.clientName.split(" ")[0] || "there";
  const sections = [applyCopy(copy.bookingPageEmailBody, { name: first, link: input.link })];

  if (input.paymentRef && (settings.bankAccountName || settings.bankSortCode || settings.bankAccountNumber)) {
    const bank = ["For bank transfers:"];
    if (settings.bankAccountName) bank.push(`  Account name: ${settings.bankAccountName}`);
    if (settings.bankSortCode) bank.push(`  Sort code: ${settings.bankSortCode}`);
    if (settings.bankAccountNumber) bank.push(`  Account number: ${settings.bankAccountNumber}`);
    bank.push(`  Reference: ${input.paymentRef}`, "", "Please use that reference every time — it's how I match your payment to you.");
    sections.push(bank.join("\n"));
  }
  if (input.paymentRef && settings.bankPaymentNote) sections.push(settings.bankPaymentNote);
  sections.push(resolveSignOff(settings));
  return { subject: copy.bookingPageEmailSubject, body: sections.join("\n\n") };
}
