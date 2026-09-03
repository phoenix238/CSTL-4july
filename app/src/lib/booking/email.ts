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
  /** the short confirmation a returning client gets, shared by both clinics */
  emailTemplateReturning?: string;
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
  /** bank details, so the first email answers "how do I pay you" in full */
  bankAccountName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  bankPaymentNote?: string;
  /** the one sign-off every email ends on — appended after any sign-off in the letter is stripped */
  emailSignOff?: string;
}

/** The one sign-off, from settings, with a safe default if it was cleared. */
export function resolveSignOff(s: { emailSignOff?: string }): string {
  return s.emailSignOff?.trim() || "with gratitude\nPhoenix";
}

/**
 * The map pin as a bare link.
 *
 * The pin field is meant to hold a URL, but a link pasted with a sentence around
 * it ("park round the back — https://maps…") used to drop the whole sentence into
 * the email as the map line. Pull the first http(s) link out when there is one;
 * otherwise keep the field as-is, so a what3words or bare-token pin still works.
 */
export function firstUrl(raw: string): string {
  const t = raw.trim();
  const m = t.match(/https?:\/\/\S+/);
  return m ? m[0] : t;
}

/**
 * Stand-ins for the links in the browser preview, where the client's tokens
 * don't exist yet (they're minted server-side when the booking is made).
 *
 * They have to be substituted back out before sending, because the preview box
 * is editable and whatever it holds is what gets sent — so a preview shown with
 * "(your personal intake link)" in it was emailing exactly that to the client,
 * in place of the link. See fillPreviewLinks.
 */
export const PREVIEW_INTAKE_LINK = "(your personal intake link)";
export const PREVIEW_PORTAL_LINK = "(your personal booking page)";
export const PREVIEW_PAYMENT_REF = "(your payment reference)";

/** The links and reference that belong to one client, resolved before composing. */
export interface ClientLinks {
  /** their personal intake form */
  intakeLink: string;
  /** their permanent booking page (/me/[token]) — where they rebook and find payment details */
  portalLink?: string;
  /** the reference they put on a bank transfer */
  paymentRef?: string;
  /** one-tap "add to Google Calendar" link for this session */
  calendarGoogleUrl?: string;
  /** download this session as an .ics (Apple Calendar / Outlook / everything else) */
  calendarIcsUrl?: string;
}

/**
 * The "add this to your calendar" block. The Google invite already reaches a
 * client who uses Google Calendar and accepts it; this is what a client who
 * keeps their calendar elsewhere gets — a one-tap Google link and an .ics for
 * Apple Calendar, Outlook and the rest. Empty when the links aren't available
 * (e.g. the browser preview, before the client's tokens exist).
 */
function calendarBlock(links: ClientLinks): string {
  if (!links.calendarGoogleUrl && !links.calendarIcsUrl) return "";
  const lines = ["Add this to your own calendar so it's there wherever you look:"];
  if (links.calendarGoogleUrl) lines.push(`  Google Calendar: ${links.calendarGoogleUrl}`);
  if (links.calendarIcsUrl) lines.push(`  Apple Calendar / Outlook / other: ${links.calendarIcsUrl}`);
  return lines.join("\n");
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

/** Fill {placeholders} from a template. Unknown ones are left alone, not blanked. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** The welcome letter: the shared one, or the old per-clinic one until it's saved. */
export function resolveTemplate(clinic: Clinic, s: EmailSettings): string {
  const shared = s.emailTemplate?.trim();
  if (shared) return shared;
  return (clinic === "waterloo" ? s.emailTemplateWaterloo : s.emailTemplateBethnal) ?? "";
}

/** The returning-client confirmation, with the old hardcoded wording as the floor. */
export const RETURNING_TEMPLATE_FALLBACK = "Hi {name},\n\nJust confirming your next session: {when} at {clinic}.";

export function resolveReturningTemplate(s: EmailSettings): string {
  return s.emailTemplateReturning?.trim() || RETURNING_TEMPLATE_FALLBACK;
}

/** Everything that varies by clinic, resolved once. */
function clinicDetails(clinic: Clinic, s: EmailSettings) {
  const w = clinic === "waterloo";
  return {
    address: (w ? s.waterlooAddress : s.bethnalAddress) ?? "",
    // The pin Phoenix curated in Settings, if he set one. A generated
    // "search Google Maps for this address" link is the fallback, not the
    // default — it was landing people on a search page rather than the door.
    locationUrl: firstUrl((w ? s.waterlooLocationUrl : s.bethnalLocationUrl) ?? ""),
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
 * How to pay, as one block: the wording from Settings, then the account details
 * and — the part that makes a bank transfer matchable — their own reference.
 *
 * The reference used to go out in a separate "Your booking page" email, which
 * meant a new client's payment information arrived split across two messages
 * sent at different times, and the half with the reference in it was the half
 * that was easy to miss.
 */
function paymentBlock(s: EmailSettings, paymentRef?: string): string {
  const bank = [
    s.bankAccountName?.trim() && `  Account name: ${s.bankAccountName.trim()}`,
    s.bankSortCode?.trim() && `  Sort code: ${s.bankSortCode.trim()}`,
    s.bankAccountNumber?.trim() && `  Account number: ${s.bankAccountNumber.trim()}`,
    paymentRef && `  Reference: ${paymentRef}`,
  ].filter(Boolean) as string[];

  // The free-text note, minus any line that just repeats the structured bank
  // numbers below — so the same sort code / account number typed into both the
  // free-text box and the bank fields doesn't go out twice. Prose ("card on the
  // day", "pay what feels fair") is kept; a line carrying the account number or
  // sort code is dropped once the structured fields are filling it in properly.
  const digits = (x?: string) => (x ?? "").replace(/\D/g, "");
  const acct = digits(s.bankAccountNumber);
  const sort = digits(s.bankSortCode);
  const freeText =
    bank.length && s.paymentDetails.trim()
      ? s.paymentDetails
          .split("\n")
          .filter((line) => {
            const d = digits(line);
            if (acct.length >= 6 && d.includes(acct)) return false;
            if (sort.length >= 6 && d.includes(sort)) return false;
            return true;
          })
          .join("\n")
          .trim()
      : s.paymentDetails.trim();

  const lines = [freeText].filter(Boolean);
  if (bank.length) {
    lines.push(["For bank transfers:", ...bank].join("\n"));
    if (paymentRef) lines.push("Please use that reference every time — it's how I match your payment to you.");
  }
  if (s.bankPaymentNote?.trim()) lines.push(s.bankPaymentNote.trim());
  return lines.join("\n\n");
}

/**
 * What the confirmation email contains, and deliberately only two shapes of it:
 *
 *  - **First time** → one email carrying everything a new client ever needs:
 *    the letter in Phoenix's own words, when and where, how to find the door,
 *    how to pay and with what reference, their own booking page (which is how
 *    they book every session after this one), and the intake form. It replaces
 *    the drip of separate welcome / booking-page / intake emails that used to
 *    follow a first booking, each carrying one piece of the same picture.
 *
 *  - **Every time after** → a confirmation and a map. Nothing else: they have
 *    their page, they know how to pay, and they've filled the form in. Repeating
 *    all of it on every rebooking is how a returning client learns to skim past
 *    the email that also contains the address.
 *
 * Within the first email the order is fixed and the sign-off is always last,
 * because it answers, in this order: when is it, where is it, how do I get in,
 * what do I owe, where do I do all this myself next time, what do you need from
 * me. The editable template supplies the voice; the facts are assembled around
 * it rather than glued on the end.
 *
 * Pure — also runs in the browser for the live preview in the booking panel, where
 * the real tokens don't exist yet, so placeholder link strings are passed instead.
 */
export function composeBookingEmail(
  client: { name: string; welcomeSent: boolean },
  clinic: Clinic,
  whenLabel: string,
  sendPayment: boolean,
  settings: EmailSettings,
  links: ClientLinks = {
    intakeLink: PREVIEW_INTAKE_LINK,
    portalLink: PREVIEW_PORTAL_LINK,
    paymentRef: PREVIEW_PAYMENT_REF,
  },
): ComposedEmail {
  const isFirstEmail = !client.welcomeSent;
  const subject = `Your craniosacral session — ${whenLabel} · ${CLINIC_LABEL[clinic]}`;
  const { address, locationUrl, directions } = clinicDetails(clinic, settings);
  const { intakeLink, portalLink, paymentRef } = links;
  const includes: string[] = ["Google Calendar invite attached"];

  // Where it is — one block, not an address line and a separate map line. The
  // address is the human-readable part; the link is attached to it.
  const whereBlock = [address, locationUrl || (address ? mapsSearchUrl(address) : ""), directions]
    .filter(Boolean)
    .join("\n");
  if (address || locationUrl) includes.push(directions ? "Address, map link & how to find it" : "Address & map link");

  // The placeholders both letters share. The first email adds its own below.
  const common: Record<string, string> = {
    name: client.name,
    when: whenLabel,
    clinic: CLINIC_LABEL[clinic],
    price: CLINIC_PRICE[clinic],
  };

  if (!isFirstEmail) {
    // Same shape as the first email — voice on top, facts placed around it,
    // signed once at the end — so a sign-off left in the template can't produce
    // an email that ends twice.
    const { main } = splitSignOff(fillTemplate(resolveReturningTemplate(settings), common));
    const calendar = calendarBlock(links);
    if (calendar) includes.push("Add-to-calendar links (Google, Apple, Outlook)");
    const body = [main, whereBlock, calendar, resolveSignOff(settings)].filter(Boolean).join("\n\n");
    return { subject, body, includes };
  }

  // One letter for both clinics — what differs between them (the price, and the
  // location block assembled above) is filled in around it, so the wording only
  // has to be written once.
  const template = resolveTemplate(clinic, settings);
  const filled = fillTemplate(template, {
    ...common,
    accessNote: settings.accessNote,
    intakeLink,
    portalLink: portalLink ?? "",
    paymentRef: paymentRef ?? "",
  });
  // Any sign-off the letter carries is dropped here and replaced by the single
  // emailSignOff below, so every email ends the same way and can't end twice.
  const { main } = splitSignOff(filled);

  const calendar = calendarBlock(links);
  if (calendar) includes.push("Add-to-calendar links (Google, Apple, Outlook)");
  const sections = [main, whereBlock, calendar];

  // Payment, once. The templates already name the price in their own words, so
  // repeating it as a "Payment (£30–60 sliding scale):" heading said the same
  // thing twice. Only the details that aren't already in the letter go here.
  if (sendPayment) {
    const payment = paymentBlock(settings, paymentRef);
    if (payment) {
      sections.push(payment);
      includes.push(
        paymentRef ? `Payment details & their reference ${paymentRef}` : `Payment details — ${CLINIC_PRICE[clinic]}`,
      );
    }
  }

  // Their booking page. This is the piece that turns the first email into the
  // only one they need: every session after this one is booked from here, and
  // the payment details and reference live on the same page — so it's described
  // by what it's for, not as "your account".
  if (portalLink && !template.includes("{portalLink}")) {
    sections.push(
      [
        "This is your own page for everything after today:",
        portalLink,
        "Book your next session from there whenever you're ready, move or cancel this one, and find my payment details and your reference any time. No login — just keep the link, it's worth bookmarking.",
      ].join("\n"),
    );
  }
  if (portalLink) includes.push("Their own booking page — rebooking & payment details");

  // The one thing the client has to *do*, kept last so it's the final ask —
  // unless the template already positioned it with {intakeLink}.
  if (!template.includes("{intakeLink}")) {
    sections.push(
      `Before we meet, please fill in your short intake form — a couple of minutes, and it goes straight into your confidential record:\n${intakeLink}`,
    );
  }
  includes.push("Intake form link");
  if (settings.accessNote.trim()) includes.push("Access note — stairs, no step-free access");

  sections.push(resolveSignOff(settings));
  return { subject, body: sections.filter(Boolean).join("\n\n"), includes };
}

/**
 * Swap the preview stand-ins in a hand-edited email body for the real thing.
 *
 * Applied on the way out to whatever body the booking panel sends, edited or
 * not. Without it the preview's own placeholder text is what the client
 * receives — an email politely telling them to visit "(your personal intake
 * link)".
 */
export function fillPreviewLinks(body: string, links: ClientLinks): string {
  return body
    .split(PREVIEW_INTAKE_LINK)
    .join(links.intakeLink)
    .split(PREVIEW_PORTAL_LINK)
    .join(links.portalLink ?? "")
    .split(PREVIEW_PAYMENT_REF)
    .join(links.paymentRef ?? "");
}

const mapsSearchUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
