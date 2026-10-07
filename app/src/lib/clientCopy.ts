import { fillIdentity } from "./practitioner";

// Every word a client sees, in one editable place. Each field has a built-in
// default (below); Phoenix can override any of them from Settings, stored as a
// JSON blob on AppSettings.clientCopy. Consumers call resolveClientCopy() to get
// a fully-populated object (stored overrides layered over these defaults), and
// applyCopy() to fill in {placeholders}. Kept pure so it runs on both server
// (emails) and, passed in as props, the client-facing pages.

export interface ClientCopy {
  // — Booking confirmation (welcome + returning). The letters themselves are
  //   AppSettings.emailTemplate / emailTemplateReturning; these are the parts
  //   the composer places around them. —
  bookingEmailSubject: string; // {when} {clinic}
  /** new clients only — introduces their own booking page */
  bookingEmailPortalPara: string; // {link}
  /** new clients only — the ask to fill in the intake form */
  bookingEmailIntakePara: string; // {link}

  // — Offer email ("here are some times") —
  offerEmailSubject: string; // {clinic}
  offerEmailBody: string; // {name} {clinic} {times} {pickLink}
  offerPickLinkLine: string; // {link} — inserted as {pickLink} when a self-book link exists

  // — Intake email (sent on its own, after booking) —
  intakeEmailSubject: string;
  intakeEmailBody: string; // {name} {link}

  // — Intake form page (what a client opens) —
  intakePageTitle: string;
  intakePageIntro: string;
  intakeEmailHelp: string; // helper under the email field
  intakeThanksTitle: string;
  intakeThanksBody: string;

  // — Public booking page (/book) —
  bookPageTitle: string;
  bookPageIntro: string;

  // — "You're booked" confirmation screen (public book + offer-pick) —
  confirmTitle: string;
  confirmBodySent: string; // {emailLine} resolves to " to name@email" or ""
  confirmBodyPending: string;
  confirmIntakeCardTitle: string;
  confirmIntakeCardBody: string;
  /** shown instead of the intake card when a returning client has already filled it in */
  confirmReturningNote: string;

  // — Offer-pick page (client taps one of the offered times) —
  offerPickTitle: string; // {name}
  offerPickIntro: string; // {clinic}

  // — Session reminder email (sent by the daily sweep at the client's chosen
  //   lead times). Voice only: the composer places the when/where, add-to-
  //   calendar links and the booking-page link around it. —
  reminderEmailSubject: string; // {when} {clinic}
  reminderEmailBody: string; // {name} {when} {clinic}

  // — A client moves a session from their own booking page. —
  movedEmailSubject: string;
  movedEmailBody: string; // {name} {when} {clinic} {previousWhen}

  // — A session is cancelled from the client's booking page. —
  cancelEmailSubject: string;
  cancelEmailBody: string; // {name} {when} {clinic}
  /** added only when the cancellation was short notice and a contribution is suggested */
  cancelGoodwillText: string; // {amount} {paymentRef}
  /** shown under a cancellation, pointing back to their page */
  cancelRebookLine: string; // {link}
  /** shown under a move, so they know they can change it again */
  changeAnyTimeLine: string; // {link}

  // — Payment reminder (you press "Send reminder" on an unpaid session). Your
  //   bank details and their reference are placed after the message for you. —
  paymentReminderSubject: string;
  paymentReminderBody: string; // {name} {when} {clinic}
  /** the closing line for a sliding-scale clinic (Bethnal Green) */
  paymentReminderClosingSliding: string; // {price}
  /** the closing line for a fixed-price clinic (Waterloo) */
  paymentReminderClosingFixed: string; // {price}

  // — Receipt (the PDF is attached and the paid sessions listed for you) —
  receiptEmailSubject: string;
  receiptEmailIntro: string; // {name}
  receiptEmailClosing: string;

  // — "Your booking page" link email (from a client's profile, or when a
  //   client asks for their link again) —
  bookingPageEmailSubject: string;
  bookingPageEmailBody: string; // {name} {link}
}

export const CLIENT_COPY_DEFAULTS: ClientCopy = {
  bookingEmailSubject: "Your craniosacral session — {when} · {clinic}",
  bookingEmailPortalPara:
    "This is your own page for everything after today:\n{link}\nBook your next session from there whenever you're ready, move or cancel this one, and find my payment details and your reference any time. No login — just keep the link, it's worth bookmarking.",
  bookingEmailIntakePara:
    "Before we meet, please fill in your short intake form — a couple of minutes, and it goes straight into your confidential record:\n{link}",

  offerEmailSubject: "Some session times — {clinic}",
  offerEmailBody:
    "Hi {name},\n\nLovely to hear from you. I've got a few times that could work at {clinic} — let me know which suits and I'll confirm it:\n\n{times}\n\n{pickLink}with gratitude\n{yourName}",
  offerPickLinkLine: "Or click here to pick one yourself and it'll be booked straight away:\n{link}\n\n",

  intakeEmailSubject: "Your intake form — {practiceName}",
  intakeEmailBody:
    "Hi {name},\n\nWhen you get a moment, please fill in your short intake form — it takes a couple of minutes and goes straight into your confidential record:\n\n{link}\n\nwith gratitude\n{yourName}",

  intakePageTitle: "Your intake form",
  intakePageIntro:
    "A few details before your craniosacral session with {yourFullName} — it takes a couple of minutes and helps {yourName} prepare so you can settle in quickly on the day. Everything here is private and kept in your confidential record.",
  intakeEmailHelp: "So {yourName} can send your session details.",
  intakeThanksTitle: "Thank you",
  intakeThanksBody:
    "Your details are with {yourName} — looking forward to seeing you.",

  bookPageTitle: "Book a session",
  bookPageIntro:
    "Craniosacral therapy with {yourFullName} — a gentle, hands-on session to help your nervous system settle. Pick a time below; you'll get a confirmation email straight after with everything you need, including a quick intake form to fill out beforehand.",

  confirmTitle: "You're booked",
  confirmBodySent:
    "A confirmation email is on its way{emailLine}, with your calendar invite, the address, and everything else you need.",
  confirmBodyPending:
    "Your slot is confirmed — we're just having trouble getting the confirmation email out, so we'll be in touch with the details another way. Feel free to fill out the intake form below in the meantime.",
  confirmIntakeCardTitle: "Before your session: the intake form",
  confirmIntakeCardBody:
    "A short form covering your health history and what you'd like from the session. It takes about 3 minutes and helps {yourName} prepare properly before you arrive — worth doing ahead of time rather than on the day. We've also emailed you this link.",
  confirmReturningNote:
    "Lovely to see you again — nothing else to fill in. Your confirmation is on its way, and you can change or cancel this any time from your own booking page.",

  offerPickTitle: "Pick a time, {name}",
  offerPickIntro: "Here are the times offered for {clinic} — tap one to book it straight away.",

  reminderEmailSubject: "A reminder: your session {when}",
  reminderEmailBody:
    "Hi {name},\n\nJust a gentle reminder that your craniosacral session is coming up: {when} at {clinic}. Looking forward to seeing you.",

  movedEmailSubject: "Your session has been moved",
  movedEmailBody:
    "Hi {name},\n\nYour session has been moved to {when} at {clinic}.\n\nYour calendar invite has been updated — the new time should appear automatically.\n\n(Previously {previousWhen}.)",

  cancelEmailSubject: "Your session has been cancelled",
  cancelEmailBody: "Hi {name},\n\nYour session on {when} at {clinic} has been cancelled.",
  cancelGoodwillText:
    "Because it was short notice the room was already paid for, so if you're able to, a {amount} contribution helps cover it.\nThis is a donation-based clinic though — if that's too much right now, please don't pay it. That's completely okay, and nothing is owed either way.\n\nIf you'd like to, the reference is {paymentRef}.",
  cancelRebookLine: "Whenever you're ready to book again, your page is here:\n{link}",
  changeAnyTimeLine: "You can change or cancel this any time from your page:\n{link}",

  paymentReminderSubject: "Your craniosacral session",
  paymentReminderBody:
    "Hi {name},\n\nJust a gentle note about your session on {when} at {clinic}. Whenever you're able, here's how to settle it.",
  paymentReminderClosingSliding:
    "This is a donation-based practice on a {price}, so pay what feels fair. If you need more time to pay, just let me know when that'll be.",
  paymentReminderClosingFixed: "The session is {price}. If you need more time to pay, just let me know when that'll be.",

  receiptEmailSubject: "Your receipt — {practiceName}",
  receiptEmailIntro:
    "Hi {name},\n\nHere's your receipt for craniosacral therapy with {yourFullName} — attached as a PDF you can download and keep.",
  receiptEmailClosing: "Any questions, just reply to this email.",

  bookingPageEmailSubject: "Your booking page",
  bookingPageEmailBody:
    "Hi {name},\n\nHere's your own page for booking sessions with me:\n{link}\n\nYou can book your next session whenever you're ready, move it, or cancel it — no login needed, just keep the link. It's worth bookmarking or saving to your home screen.\n\nAny questions, just reply.",
};

/** Keys of ClientCopy, for iterating in the Settings editor. */
export const CLIENT_COPY_KEYS = Object.keys(CLIENT_COPY_DEFAULTS) as (keyof ClientCopy)[];

/**
 * Merge whatever is stored in AppSettings.clientCopy over the built-in defaults,
 * so every field is always present. A blank stored value falls back to default.
 *
 * Pass `identity` (from practitionerIdentity) to fill {yourName} and friends —
 * every caller that shows or sends the words does. The Settings editor omits it,
 * so the practitioner sees and edits the placeholder rather than their own name.
 */
export function resolveClientCopy(raw: unknown, identity?: Record<string, string>): ClientCopy {
  const out = { ...CLIENT_COPY_DEFAULTS };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of CLIENT_COPY_KEYS) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) out[key] = v;
    }
  }
  if (identity) for (const key of CLIENT_COPY_KEYS) out[key] = fillIdentity(out[key], identity);
  return out;
}

/**
 * Fill a template, dropping any line whose placeholder has nothing to fill it.
 *
 * For the optional parts of a message — "(Previously {previousWhen}.)" on a
 * move that has no previous time, "the reference is {paymentRef}" for a client
 * with none — so the practitioner writes the line once and it simply isn't
 * there when it doesn't apply, rather than reading "the reference is ." .
 */
export function applyCopyOptional(template: string, vars: Record<string, string>): string {
  const empty = Object.entries(vars)
    .filter(([, v]) => !v.trim())
    .map(([k]) => `{${k}}`);
  const kept = template.split("\n").filter((line) => !empty.some((p) => line.includes(p)));
  return applyCopy(kept.join("\n"), vars)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fill in {placeholders} from a template. Unknown placeholders are left as-is. */
export function applyCopy(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}
