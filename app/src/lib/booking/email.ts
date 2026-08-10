import { CLINIC_LABEL, CLINIC_PRICE, type Clinic } from "./rules";

export interface ComposedEmail {
  subject: string;
  body: string;
  /** the ✓-list shown in the booking panel and confirmation screen */
  includes: string[];
}

/** The settings fields the email needs — plain shape so the browser can pass /api/settings JSON. */
export interface EmailSettings {
  /** the one welcome letter, shared by both clinics */
  emailTemplate?: string;
  /** legacy per-clinic letters — the fallback until `emailTemplate` is saved */
  emailTemplateWaterloo?: string;
  emailTemplateBethnal?: string;
  accessNote: string;
  paymentDetails: string;
  waterlooAddress: string;
  bethnalAddress: string;
  /** the map pin you actually chose, per clinic — preferred over a generated search link */
  waterlooLocationUrl?: string;
  bethnalLocationUrl?: string;
  /** how to find the door: buzzer, floor, parking */
  waterlooFindIt?: string;
  bethnalFindIt?: string;
  /** photo of the entrance, as a data: URL */
  waterlooPhoto?: string;
  bethnalPhoto?: string;
  /** legacy pair, folded into `*FindIt` above */
  waterlooDirections?: string;
  bethnalDirections?: string;
  waterlooArrivalNote?: string;
  bethnalArrivalNote?: string;
}

/**
 * How to find and get into one clinic.
 *
 * Exported because the public booking page shows the same thing under the
 * address — it used to read a separate "arrival note" field while the email
 * read "directions", so the two surfaces could tell a client different things
 * about the same front door.
 */
export function resolveFindIt(clinic: Clinic, s: EmailSettings): string {
  const w = clinic === "waterloo";
  const current = (w ? s.waterlooFindIt : s.bethnalFindIt)?.trim();
  if (current) return current;
  // Nothing saved in the merged field yet — fall back to whatever the old pair
  // holds, so existing wording keeps working untouched.
  return [(w ? s.waterlooDirections : s.bethnalDirections)?.trim(), (w ? s.waterlooArrivalNote : s.bethnalArrivalNote)?.trim()]
    .filter(Boolean)
    .join("\n");
}

/** The entrance photo for one clinic, as a data: URL — empty string if none set. */
export function resolveClinicPhoto(clinic: Clinic, s: EmailSettings): string {
  return ((clinic === "waterloo" ? s.waterlooPhoto : s.bethnalPhoto) ?? "").trim();
}

/** The welcome letter: the shared one, or the old per-clinic one until it's saved. */
export function resolveTemplate(clinic: Clinic, s: EmailSettings): string {
  const shared = s.emailTemplate?.trim();
  if (shared) return shared;
  return (clinic === "waterloo" ? s.emailTemplateWaterloo : s.emailTemplateBethnal) ?? "";
}

/** Everything that varies by clinic, resolved once. */
function clinicDetails(clinic: Clinic, s: EmailSettings) {
  const w = clinic === "waterloo";
  return {
    address: (w ? s.waterlooAddress : s.bethnalAddress) ?? "",
    // The pin Phoenix curated in Settings, if he set one. A generated
    // "search Google Maps for this address" link is the fallback, not the
    // default — it was landing people on a search page rather than the door.
    locationUrl: (w ? s.waterlooLocationUrl : s.bethnalLocationUrl)?.trim() ?? "",
    directions: resolveFindIt(clinic, s),
  };
}

/**
 * A trailing sign-off, if the template ends with one.
 *
 * Templates are written as whole letters, ending "See you soon, / Phoenix" —
 * so anything the composer appended landed *after* the signature, and the
 * client got an email that signed off halfway down and then kept going with
 * the address and the payment details. Lifting the sign-off out lets the
 * factual block sit above it, where it belongs.
 */
function splitSignOff(body: string): { main: string; signOff: string } {
  const paragraphs = body.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const isSignOff = paragraphs.length > 1 && last.trim().split("\n").length <= 3 && /phoenix\s*$/i.test(last.trim());
  if (!isSignOff) return { main: body.trimEnd(), signOff: "" };
  return { main: paragraphs.slice(0, -1).join("\n\n").trimEnd(), signOff: last.trim() };
}

/**
 * What the confirmation email contains:
 *  - returning client → a short confirmation with the time, place and how to
 *    get there; the calendar invite comes from Google Calendar itself.
 *  - new client (first email only) → the same, plus the location template in
 *    Phoenix's own words, the access note, the intake link and optionally
 *    payment details.
 *
 * The order is fixed and the sign-off is always last, because this email's job
 * is to answer, in this order: when is it, where is it, how do I get in, what
 * do I owe, what do you need from me. The editable template supplies the voice;
 * the facts are assembled around it rather than glued on the end.
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
  const { address, locationUrl, directions } = clinicDetails(clinic, settings);
  const includes: string[] = ["Google Calendar invite attached"];

  // Where it is — one block, not an address line and a separate map line. The
  // address is the human-readable part; the link is attached to it.
  const whereBlock = [address, locationUrl || (address ? mapsSearchUrl(address) : ""), directions]
    .filter(Boolean)
    .join("\n");
  if (address || locationUrl) includes.push(directions ? "Address, map link & how to find it" : "Address & map link");

  if (!isFirstEmail) {
    const body = [
      `Hi ${client.name},`,
      `Just confirming your next session: ${whenLabel} at ${CLINIC_LABEL[clinic]}.`,
      whereBlock,
      "See you soon,\nPhoenix",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { subject, body, includes };
  }

  // One letter for both clinics — what differs between them (the price, and the
  // location block assembled above) is filled in around it, so the wording only
  // has to be written once.
  const template = resolveTemplate(clinic, settings);
  const filled = template
    .split("{name}")
    .join(client.name)
    .split("{accessNote}")
    .join(settings.accessNote)
    .split("{when}")
    .join(whenLabel)
    .split("{clinic}")
    .join(CLINIC_LABEL[clinic])
    .split("{price}")
    .join(CLINIC_PRICE[clinic])
    .split("{intakeLink}")
    .join(intakeLink);
  const { main, signOff } = splitSignOff(filled);

  const sections = [main, whereBlock];

  // Payment, once. The templates already name the price in their own words, so
  // repeating it as a "Payment (£30–60 sliding scale):" heading said the same
  // thing twice. Only the details that aren't already in the letter go here.
  if (sendPayment && settings.paymentDetails.trim()) {
    sections.push(settings.paymentDetails.trim());
    includes.push(`Payment details — ${CLINIC_PRICE[clinic]}`);
  }

  // The one thing the client has to *do*, kept last so it's the final ask —
  // unless the template already positioned it with {intakeLink}.
  if (!template.includes("{intakeLink}")) {
    sections.push(
      `Before we meet, please fill in your short intake form — a couple of minutes, and it goes straight into your confidential record:\n${intakeLink}`,
    );
  }
  includes.push("Intake form link");
  if (settings.accessNote.trim()) includes.push("Access note — stairs, no step-free access");

  sections.push(signOff || "See you soon,\nPhoenix");
  return { subject, body: sections.filter(Boolean).join("\n\n"), includes };
}

const mapsSearchUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
