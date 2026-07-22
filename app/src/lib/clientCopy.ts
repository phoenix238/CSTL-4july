// Every word a client sees, in one editable place. Each field has a built-in
// default (below); Phoenix can override any of them from Settings, stored as a
// JSON blob on AppSettings.clientCopy. Consumers call resolveClientCopy() to get
// a fully-populated object (stored overrides layered over these defaults), and
// applyCopy() to fill in {placeholders}. Kept pure so it runs on both server
// (emails) and, passed in as props, the client-facing pages.

export interface ClientCopy {
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

  // — Offer-pick page (client taps one of the offered times) —
  offerPickTitle: string; // {name}
  offerPickIntro: string; // {clinic}
}

export const CLIENT_COPY_DEFAULTS: ClientCopy = {
  offerEmailSubject: "Some session times — {clinic}",
  offerEmailBody:
    "Hi {name},\n\nLovely to hear from you. I've got a few times that could work at {clinic} — let me know which suits and I'll confirm it:\n\n{times}\n\n{pickLink}Warm wishes,\nPhoenix",
  offerPickLinkLine: "Or click here to pick one yourself and it'll be booked straight away:\n{link}\n\n",

  intakeEmailSubject: "Your intake form — Phoenix Tanner CSTL",
  intakeEmailBody:
    "Hi {name},\n\nWhen you get a moment, please fill in your short intake form — it takes a couple of minutes and goes straight into your confidential record:\n\n{link}\n\nSee you soon,\nPhoenix",

  intakePageTitle: "Your intake form",
  intakePageIntro:
    "A few details before your craniosacral session with Phoenix Tanner — it takes a couple of minutes and helps him prepare so you can settle in quickly on the day. Once it's done, you'll get your Google Calendar invite and everything you need for the session. Everything here is private and kept in your confidential record.",
  intakeEmailHelp: "So Phoenix can send your Google Calendar invite and session details.",
  intakeThanksTitle: "Thank you",
  intakeThanksBody:
    "Your details are with Phoenix. Your Google Calendar invite and session details are on their way to your email — looking forward to seeing you.",

  bookPageTitle: "Book a session",
  bookPageIntro:
    "Craniosacral therapy with Phoenix Tanner — a gentle, hands-on session to help your nervous system settle. Pick a time below; you'll get a confirmation email straight after with everything you need, including a quick intake form to fill out beforehand.",

  confirmTitle: "You're booked",
  confirmBodySent:
    "A confirmation email is on its way{emailLine}, with your calendar invite, the address, and everything else you need.",
  confirmBodyPending:
    "Your slot is confirmed — we're just having trouble getting the confirmation email out, so we'll be in touch with the details another way. Feel free to fill out the intake form below in the meantime.",
  confirmIntakeCardTitle: "Before your session: the intake form",
  confirmIntakeCardBody:
    "A short form covering your health history and what you'd like from the session. It takes about 3 minutes and helps Phoenix prepare properly before you arrive — worth doing ahead of time rather than on the day. We've also emailed you this link.",

  offerPickTitle: "Pick a time, {name}",
  offerPickIntro: "Here are the times offered for {clinic} — tap one to book it straight away.",
};

/** Keys of ClientCopy, for iterating in the Settings editor. */
export const CLIENT_COPY_KEYS = Object.keys(CLIENT_COPY_DEFAULTS) as (keyof ClientCopy)[];

/**
 * Merge whatever is stored in AppSettings.clientCopy over the built-in defaults,
 * so every field is always present. A blank stored value falls back to default.
 */
export function resolveClientCopy(raw: unknown): ClientCopy {
  const out = { ...CLIENT_COPY_DEFAULTS };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of CLIENT_COPY_KEYS) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) out[key] = v;
    }
  }
  return out;
}

/** Fill in {placeholders} from a template. Unknown placeholders are left as-is. */
export function applyCopy(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}
