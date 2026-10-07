"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, OutlineButton, PrimaryButton, useToast } from "./ui";
import { CLIENT_COPY_DEFAULTS, CLIENT_COPY_KEYS, applyCopy, type ClientCopy } from "@/lib/clientCopy";
import { composeBookingEmail, type EmailSettings } from "@/lib/booking/email";
import { useActiveSpaces, useSpaces } from "./SpacesContext";
import { spacePriceLabel, type Space } from "@/lib/spaces";
import { fillIdentity, IDENTITY_PLACEHOLDERS, practitionerIdentity } from "@/lib/practitioner";

// The saved bank settings the exact-email preview needs but doesn't edit here
// (bank details live under Client Pages; each space's address and directions
// come from your spaces). The preview reads the editable parts (letter, access
// note, payment, sign-off) live from the draft, and these from the last save.
export interface PreviewContext {
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  bankPaymentNote: string;
}

// The settings-backed messages (plain AppSettings columns, not part of clientCopy)
// that also belong in "every word a client reads" — so this one editor genuinely
// holds all of them instead of leaving them scattered in separate Settings dropdowns.
export interface SettingsMessages {
  /** who you are — filled into {yourName} {yourFullName} {practiceName} everywhere */
  practitionerName: string;
  practitionerFullName: string;
  practiceName: string;
  emailTemplate: string;
  emailTemplateReturning: string;
  emailSignOff: string;
  accessNote: string;
  paymentDetails: string;
  /** the review wording, written once for every space (each space carries its own review link) */
  reviewEmailSubject: string;
  reviewEmailBody: string;
}

/**
 * What every {placeholder} means, in plain words. Shown under each box and as
 * the chip's tooltip, so nobody has to guess what {pickLink} turns into.
 */
const PLACEHOLDER_HELP: Record<string, string> = {
  name: "their first name",
  when: "the day and time, e.g. Fri 14 Aug · 12:15",
  clinic: "which space they booked",
  price: "that space's price",
  times: "the list of times you picked",
  pickLink: "the self-book link line (written further down)",
  link: "their personal link (see the description above)",
  intakeLink: "their intake form link",
  accessNote: "your access note (written under “Written once”)",
  mapsUrl: "the Google review link of the space they were seen at",
  optInLink: "their one-tap “send me news” link",
  emailLine: "“ to their@email” — or nothing if there's no email",
  previousWhen: "the old time — the whole line is left out if there isn't one",
  amount: "the suggested contribution, e.g. £10",
  paymentRef: "their bank reference, e.g. MAYA-4K2 — line left out if none",
  hours: "the notice needed to move or cancel, in hours (Settings › Client pages)",
  yourName: "your first name",
  yourFullName: "your full name",
  practiceName: "your practice's name",
};

/** When a message goes out — the badge on every email. */
type Trigger = "auto" | "button" | "auto-or-button";
const TRIGGER_LABEL: Record<Trigger, string> = {
  auto: "Sends itself",
  button: "You press a button",
  "auto-or-button": "Sends itself, or on a button",
};

/** The "send me a test" types the server knows (api/settings/test-email). */
type TestType =
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
  | "no-show";

type CopyField = { key: keyof ClientCopy; label: string; multiline?: boolean; placeholders?: string[] };
type SettingsField = { key: keyof SettingsMessages; label: string; multiline?: boolean; placeholders?: string[] };
type Field = ({ source: "copy" } & CopyField) | ({ source: "settings" } & SettingsField);

interface Group {
  title: string;
  /** when it goes out, in one sentence */
  when?: string;
  /** who receives it */
  who?: string;
  trigger?: Trigger;
  blurb: string;
  fields: Field[];
  test?: TestType;
}

const c = (key: keyof ClientCopy, label: string, extra: Omit<CopyField, "key" | "label"> = {}): Field => ({
  source: "copy",
  key,
  label,
  ...extra,
});
const st = (key: keyof SettingsMessages, label: string, extra: Omit<SettingsField, "key" | "label"> = {}): Field => ({
  source: "settings",
  key,
  label,
  ...extra,
});

// Who you are — first, because every message below can use it.
const IDENTITY_GROUP: Group = {
  title: "Your details — the name on every message",
  blurb:
    "Write these once. Anywhere below you can type {yourName}, {yourFullName} or {practiceName} and it becomes these words in the email the client gets — so if your name or practice name changes, you change it here and every email follows.",
  fields: [
    st("practitionerName", "Your first name — how clients address you (e.g. Emily)"),
    st("practitionerFullName", "Your full name — for receipts and introductions (e.g. Emily Yung)"),
    st("practiceName", "Your practice name — used in subject lines"),
  ],
};

// Every email a client can get, in the order they meet them.
const EMAIL_GROUPS: Group[] = [
  {
    title: "1 · Offering times — “here are some times”",
    when: "When you offer a few times from an enquiry, before anything is booked.",
    who: "Someone who has enquired",
    trigger: "button",
    blurb: "The times you picked drop into {times}, and the link line lets them book one themselves.",
    fields: [
      c("offerEmailSubject", "Subject", { placeholders: ["clinic"] }),
      c("offerEmailBody", "Message", { multiline: true, placeholders: ["name", "clinic", "times", "pickLink"] }),
      c("offerPickLinkLine", "The self-book link line", { multiline: true, placeholders: ["link"] }),
    ],
  },
  {
    title: "2 · Booking confirmation — a new client's first booking",
    when: "The moment a new client is booked — by you, from your booking page, or from an offer link.",
    who: "A new client",
    trigger: "auto",
    test: "first",
    blurb:
      "Write the letter in your voice. The address, map pin, how to find the door, payment details, their booking page, the intake form and your sign-off are added around it for whichever space they booked — the two paragraphs below are the wording for those last two.",
    fields: [
      c("bookingEmailSubject", "Subject (also used for returning clients)", { placeholders: ["when", "clinic"] }),
      st("emailTemplate", "Welcome letter", {
        multiline: true,
        placeholders: ["name", "when", "clinic", "price", "accessNote", "intakeLink"],
      }),
      c("bookingEmailPortalPara", "Paragraph introducing their booking page ({link} = their page)", {
        multiline: true,
        placeholders: ["link"],
      }),
      c("bookingEmailIntakePara", "Paragraph asking for the intake form ({link} = their form)", {
        multiline: true,
        placeholders: ["link"],
      }),
    ],
  },
  {
    title: "3 · Booking confirmation — every booking after that",
    when: "Each time a returning client is booked.",
    who: "A returning client",
    trigger: "auto",
    test: "returning",
    blurb:
      "The short one, for someone who already has their booking page and knows how to pay. The address, map pin, how to find the door and your sign-off are added underneath.",
    fields: [st("emailTemplateReturning", "Returning confirmation", { multiline: true, placeholders: ["name", "when", "clinic", "price"] })],
  },
  {
    title: "4 · Session reminder",
    when: "Early each morning, ahead of a session — only for clients who switched reminders on from their own booking page.",
    who: "Clients who asked for reminders",
    trigger: "auto",
    test: "session-reminder",
    blurb: "The address, add-to-calendar link, booking-page link and your sign-off are added after your words.",
    fields: [
      c("reminderEmailSubject", "Subject", { placeholders: ["when", "clinic"] }),
      c("reminderEmailBody", "Message", { multiline: true, placeholders: ["name", "when", "clinic"] }),
    ],
  },
  {
    title: "5 · First session — “looking forward to meeting you”",
    when:
      "The day before a new client's first session (or that morning, if they booked too late for the day before). Every new client gets it — no need to switch reminders on.",
    who: "A new client",
    trigger: "auto",
    test: "first-session",
    blurb:
      "Two versions: one for someone who hasn't filled in the intake form yet (it includes their link and says you can do it together in the session), and one for someone who has. The address, how to find the door, their booking page and your sign-off are added after it. If they haven't switched reminders on, the reminder line is added too.",
    fields: [
      c("firstSessionSubject", "Subject", { placeholders: ["when", "clinic"] }),
      c("firstSessionBodyIntakeMissing", "Message — intake form NOT done yet", {
        multiline: true,
        placeholders: ["name", "when", "clinic", "intakeLink"],
      }),
      c("firstSessionBodyIntakeDone", "Message — intake form done", {
        multiline: true,
        placeholders: ["name", "when", "clinic"],
      }),
      c("remindersOfferLine", "Line offering reminders ({link} = the reminder ticks on their page)", {
        multiline: true,
        placeholders: ["link"],
      }),
    ],
  },
  {
    title: "6 · Intake form — sent on its own",
    when: "When you press “Send intake form” after booking someone, or on their profile.",
    who: "A client who hasn't filled it in",
    trigger: "button",
    blurb: "The intake link already rides along in the first booking confirmation; this is the standalone resend.",
    fields: [
      c("intakeEmailSubject", "Subject"),
      c("intakeEmailBody", "Message", { multiline: true, placeholders: ["name", "link"] }),
    ],
  },
  {
    title: "7 · Session moved",
    when: "When a client moves their own session from their booking page. You're copied in.",
    who: "That client",
    trigger: "auto",
    test: "moved",
    blurb: "Your sign-off is added at the end.",
    fields: [
      c("movedEmailSubject", "Subject"),
      c("movedEmailBody", "Message", { multiline: true, placeholders: ["name", "when", "clinic", "previousWhen"] }),
      c("changeAnyTimeLine", "Line pointing to their page ({link} = their page)", { multiline: true, placeholders: ["link"] }),
    ],
  },
  {
    title: "8 · Session cancelled",
    when: "When a client cancels from their booking page. You're copied in.",
    who: "That client",
    trigger: "auto",
    test: "cancellation",
    blurb:
      "The contribution paragraph is only added when they cancel at short notice and a contribution is set (Settings › Client pages); set it to £0 and it never appears.",
    fields: [
      c("cancelEmailSubject", "Subject"),
      c("cancelEmailBody", "Message", { multiline: true, placeholders: ["name", "when", "clinic"] }),
      c("cancelGoodwillText", "Short-notice contribution paragraph", { multiline: true, placeholders: ["amount", "paymentRef"] }),
      c("cancelRebookLine", "Line inviting them to rebook ({link} = their page)", { multiline: true, placeholders: ["link"] }),
    ],
  },
  {
    title: "9 · Missed session (no-show)",
    when: "When you press “No-show” on a past session (Today, or the client's account) and choose to email them.",
    who: "That client",
    trigger: "button",
    test: "no-show",
    blurb:
      "The contribution paragraph is added only when a contribution is set (Settings › Client pages) — the same amount your cancellation policy names. A line inviting them to rebook and your sign-off end it.",
    fields: [
      c("noShowEmailSubject", "Subject"),
      c("noShowEmailBody", "Message", { multiline: true, placeholders: ["name", "when", "clinic"] }),
      c("noShowGoodwillText", "Contribution paragraph", { multiline: true, placeholders: ["amount", "paymentRef"] }),
    ],
  },
  {
    title: "10 · Payment reminder",
    when: "When you press “Remind” on an unpaid session on Today. Each session is chased at most once.",
    who: "A client with an unpaid session",
    trigger: "button",
    test: "reminder",
    blurb:
      "Your bank details, their reference and a link to their page are placed between the message and the closing line. The closing line differs between a sliding-scale and a fixed-price space.",
    fields: [
      c("paymentReminderSubject", "Subject"),
      c("paymentReminderBody", "Message", { multiline: true, placeholders: ["name", "when", "clinic"] }),
      c("paymentReminderClosingSliding", "Closing line — sliding-scale space", { multiline: true, placeholders: ["price"] }),
      c("paymentReminderClosingFixed", "Closing line — fixed-price space", { multiline: true, placeholders: ["price"] }),
    ],
  },
  {
    title: "11 · Receipt",
    when: "When you press “Email receipt” on a client’s profile, when a client asks for one from their page, or once a requested receipt's payment lands.",
    who: "That client",
    trigger: "auto-or-button",
    test: "receipt",
    blurb: "The PDF is attached and the paid sessions and total are listed between the intro and closing for you.",
    fields: [
      c("receiptEmailSubject", "Subject"),
      c("receiptEmailIntro", "Intro", { multiline: true, placeholders: ["name"] }),
      c("receiptEmailClosing", "Closing line", { multiline: true }),
    ],
  },
  {
    title: "12 · Their booking page link",
    when: "When you press “Email page to …” on a client’s profile, or when a client asks for their link again.",
    who: "That client",
    trigger: "auto-or-button",
    test: "booking-page",
    blurb: "When you send it, your bank details and their reference are added underneath. Your sign-off ends it.",
    fields: [
      c("bookingPageEmailSubject", "Subject"),
      c("bookingPageEmailBody", "Message", { multiline: true, placeholders: ["name", "link"] }),
    ],
  },
  {
    title: "13 · Review request — after a session",
    when: "When you press “Send review request” on a client's profile.",
    who: "A client you've seen",
    trigger: "button",
    test: "review",
    blurb:
      "Asks for a Google review and offers a one-tap opt-in to your news. Written once for every space — {mapsUrl} becomes the Google review link of the space they were seen at, which you set on each space in Settings › Your spaces. Sign off inside this one.",
    fields: [
      st("reviewEmailSubject", "Subject"),
      st("reviewEmailBody", "Message", { multiline: true, placeholders: ["name", "mapsUrl", "optInLink"] }),
    ],
  },
];

// Written once, dropped into the emails above — not messages in their own right.
const BUILDING_BLOCK_GROUPS: Group[] = [
  {
    title: "Your cancellation policy",
    blurb:
      "Shown before they book (on your booking page and their own page) and in the first confirmation email — so a late-cancellation or missed-session contribution is never a surprise. Only shown when a contribution is set in Settings › Client pages.",
    fields: [c("cancellationPolicyLine", "Policy", { multiline: true, placeholders: ["hours", "amount"] })],
  },
  {
    title: "Your sign-off",
    blurb:
      "How every email ends (except the review request, which you sign yourself). Added once at the very end — so don't sign off inside the letters above, and no email ever ends twice.",
    fields: [st("emailSignOff", "Sign-off", { multiline: true })],
  },
  {
    title: "The access note",
    blurb:
      "Slots into the welcome letter wherever you put {accessNote} — stairs, access needs. Don't paste map links in here; the map pin is added for you from Settings › Your spaces.",
    fields: [st("accessNote", "Access note", { multiline: true })],
  },
  {
    title: "Payment wording",
    blurb:
      "Added to the first booking confirmation when you tick “include payment details”. Your account name, sort code, account number and the client's reference are added under it automatically — set those in Settings › Client pages.",
    fields: [st("paymentDetails", "Payment details", { multiline: true })],
  },
];

// The wording on the pages a client opens, rather than the emails they're sent.
const PAGE_GROUPS: Group[] = [
  {
    title: "The intake form page",
    blurb: "What a client sees when they open their intake link.",
    fields: [
      c("intakePageTitle", "Heading"),
      c("intakePageIntro", "Intro paragraph", { multiline: true }),
      c("intakeEmailHelp", "Note under the email field"),
      c("intakeThanksTitle", "Thank-you heading"),
      c("intakeThanksBody", "Thank-you message", { multiline: true }),
    ],
  },
  {
    title: "Your booking page (/book)",
    blurb: "The public page you can link from Instagram or your website.",
    fields: [c("bookPageTitle", "Heading"), c("bookPageIntro", "Intro paragraph", { multiline: true })],
  },
  {
    title: "The “you're booked” screen",
    blurb: "Shown right after a client books — on /book and via a self-book link.",
    fields: [
      c("confirmTitle", "Heading"),
      c("confirmBodySent", "Message (email went out)", { multiline: true, placeholders: ["emailLine"] }),
      c("confirmBodyPending", "Message (email didn't send)", { multiline: true }),
      c("confirmIntakeCardTitle", "Intake card heading"),
      c("confirmIntakeCardBody", "Intake card message", { multiline: true }),
      c("confirmReturningNote", "Returning client (no intake form needed)", { multiline: true }),
    ],
  },
  {
    title: "The offer-pick page",
    blurb: "What a client sees on the self-book link before choosing a time.",
    fields: [c("offerPickTitle", "Heading", { placeholders: ["name"] }), c("offerPickIntro", "Intro", { placeholders: ["clinic"] })],
  },
];

// Recommended wording for the settings-backed message fields — the clean,
// voice-only starting point the composer is built around (facts placed for you,
// signed once). Used by the per-field reset and the "fill everything" button.
// Deliberately excludes your name, which is yours.
const SETTINGS_MESSAGE_DEFAULTS: Partial<Record<keyof SettingsMessages, string>> = {
  emailTemplate:
    "Hi {name},\n\nLovely to hear from you — you're booked in for {when} at {clinic}, {price}. Everything you need for the day is below; there's nothing to print or bring.\n\n{accessNote}",
  emailTemplateReturning: "Hi {name},\n\nJust confirming your next session: {when} at {clinic}.",
  emailSignOff: "with gratitude\n{yourName}",
  accessNote:
    "My treatment space has no step-free access at either location — there are stairs. Please let me know if mobility or access is a concern and I'll do my best to accommodate you.",
  paymentDetails: "You can pay on the day by card, or by bank transfer using the details below.",
  reviewEmailSubject: "How was your session?",
  reviewEmailBody:
    "Hi {name},\n\nIt was lovely to see you. I really hope your session landed well.\n\nIf you have a moment, a short Google review means the world to a small practice like mine:\n{mapsUrl}\n\nAnd if you'd like the occasional email about offers and clinic news, you can opt in here (one tap, no obligation):\n{optInLink}\n\nwith gratitude\n{yourName}",
};

/** Settings boxes that hold a plain value (a name, a link), not wording. */
const PLAIN_VALUE_KEYS = new Set<keyof SettingsMessages>([
  "practitionerName",
  "practitionerFullName",
  "practiceName",
]);

// Sample values so the preview reads like a real message. The space and its
// price come from your first open space (see sampleFor).
const SAMPLE: Record<string, string> = {
  name: "Maya",
  when: "Fri 14 Aug · 12:15",
  clinic: "your space",
  price: "£60",
  times: "  • Tuesday 5 August at 14:00\n  • Thursday 7 August at 10:30",
  link: "https://your-site/me/ab12cd",
  pickLink: "Or click here to pick one yourself and it'll be booked straight away:\nhttps://your-site/offer/ab12cd\n\n",
  emailLine: " to maya@example.com",
  accessNote: "There are stairs — please let me know about any access needs.",
  intakeLink: "https://your-site/intake/ab12cd",
  mapsUrl: "https://g.page/r/your-review-link",
  optInLink: "https://your-site/preferences/ab12cd",
  previousWhen: "Wed 12 Aug · 10:00",
  amount: "£10",
  paymentRef: "MAYA-4K2",
  hours: "24",
};

/** The sample values, with the space and price taken from one of your own spaces. */
function sampleFor(space: Space | undefined): Record<string, string> {
  if (!space) return SAMPLE;
  return { ...SAMPLE, clinic: space.name, price: spacePriceLabel(space) || SAMPLE.price };
}

/** Small coloured tag — when a message goes out, or who gets it. */
function Badge({ children, tone }: { children: React.ReactNode; tone: "auto" | "button" | "who" }) {
  const cls =
    tone === "auto"
      ? "bg-sage-tint text-sage-text"
      : tone === "button"
        ? "bg-[oklch(0.94_0.04_60)] text-clay-text"
        : "bg-[oklch(0.94_0.01_80)] text-ink-soft";
  return <span className={`rounded-full px-2 py-[2px] text-[10.5px] font-semibold ${cls}`}>{children}</span>;
}

// One editable field: the box, tap-to-insert placeholder chips with their
// meaning, and a live preview filled with a sample client and your own name.
function FieldEditor({
  label,
  value,
  isDefault,
  placeholders,
  multiline,
  identity,
  noPlaceholders,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  isDefault: boolean;
  placeholders?: string[];
  multiline?: boolean;
  identity: Record<string, string>;
  noPlaceholders?: boolean;
  onChange: (v: string) => void;
  onReset?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  // Every wording box can use your name — subjects included. Your details
  // themselves and the review links are plain values, so they get none.
  const chips = noPlaceholders ? [] : [...(placeholders ?? []), ...IDENTITY_PLACEHOLDERS];
  const sample = sampleFor(useActiveSpaces()[0]);
  const preview = value.includes("{") ? applyCopy(value, { ...sample, ...identity }) : null;

  // Put the placeholder where the cursor is (or at the end), then put the cursor after it.
  function insert(p: string) {
    const el = ref.current;
    const token = `{${p}}`;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(value.slice(0, at) + token + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  }

  const box =
    "w-full rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink-soft">{label}</span>
        {onReset && !isDefault && (
          <button onClick={onReset} className="cursor-pointer text-[11px] font-semibold text-muted underline hover:text-ink">
            Reset to recommended
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${box} min-h-[96px] resize-y leading-[1.55]`}
        />
      ) : (
        <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} className={box} />
      )}
      {chips.length ? (
        <details className="text-[11px] text-muted">
          <summary className="cursor-pointer select-none font-semibold text-clay-text">
            Insert a detail that fills itself in ›
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {chips.map((p) => (
              <li key={p} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => insert(p)}
                  title={`Insert {${p}} — ${PLACEHOLDER_HELP[p] ?? ""}`}
                  className="flex-none cursor-pointer rounded bg-[oklch(0.94_0.01_80)] px-1.5 py-[1px] font-mono text-[10.5px] text-ink hover:bg-[oklch(0.9_0.02_80)]"
                >{`{${p}}`}</button>
                <span>{PLACEHOLDER_HELP[p] ?? ""}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {preview && (
        <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2 text-[12px] leading-[1.55] whitespace-pre-line text-[oklch(0.45_0.02_60)]">
          <span className="mb-0.5 block text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
            How it reads
          </span>
          {preview}
        </div>
      )}
    </div>
  );
}

// The exact welcome email, composed the same way the real send is, from the
// live draft — so the duplication a client used to see (the same directions
// twice, a second sign-off) is visible here before anyone gets it.
function WelcomeEmailPreview({ settings, start = "first" }: { settings: EmailSettings; start?: "first" | "returning" }) {
  const spaces = useActiveSpaces();
  const [picked, setPicked] = useState(spaces[0]?.id ?? "");
  const clinic = spaces.some((sp) => sp.id === picked) ? picked : (spaces[0]?.id ?? "");
  const clinicName = spaces.find((sp) => sp.id === clinic)?.name ?? "your space";
  const [which, setWhich] = useState<"first" | "returning">(start);
  const links = {
    intakeLink: "https://your-site/intake/ab12cd",
    portalLink: "https://your-site/me/ab12cd",
    paymentRef: "MAYA-4K2",
    calendarIcsUrl: "https://your-site/api/portal/ab12cd/ics",
  };
  const composed = composeBookingEmail(
    { name: "Maya", welcomeSent: which === "returning" },
    clinic,
    "Fri 14 Aug · 12:15",
    true,
    settings,
    links,
  );
  // Your name goes in on the way out (see sendEmail) — fill it here too, so the
  // preview reads exactly as the client's copy will.
  const identity = practitionerIdentity(settings);
  const email = { subject: fillIdentity(composed.subject, identity), body: fillIdentity(composed.body, identity) };
  const tab = (active: boolean) =>
    `cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ${
      active ? "bg-clay-text text-white" : "bg-[oklch(0.94_0.01_80)] text-muted hover:text-ink"
    }`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink-soft">Preview the exact email</span>
        <div className="flex gap-1.5">
          <button className={tab(which === "first")} onClick={() => setWhich("first")}>
            First time
          </button>
          <button className={tab(which === "returning")} onClick={() => setWhich("returning")}>
            Returning
          </button>
        </div>
      </div>
      {spaces.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {spaces.map((sp) => (
            <button key={sp.id} className={tab(clinic === sp.id)} onClick={() => setPicked(sp.id)}>
              {sp.name}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2.5">
        <div className="border-b border-line pb-1.5 text-[12px] font-semibold text-ink">{email.subject}</div>
        <div className="whitespace-pre-line pt-2 text-[12px] leading-[1.55] text-[oklch(0.4_0.02_60)]">
          {email.body}
        </div>
      </div>
      <p className="text-[10.5px] text-faint">
        Sample data (Maya, a session at {clinicName}). {which === "first" ? "A new" : "A returning"} client sees this —
        the address, map pin, how-to-find, payment and sign-off are placed once, in order.
      </p>
    </div>
  );
}

/** A quiet divider between the three kinds of thing in this list. */
function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 px-1 text-[10.5px] font-semibold tracking-[0.09em] text-faint uppercase first:mt-0">
      {children}
    </div>
  );
}


const WELCOME_TITLE = EMAIL_GROUPS[1].title;
const RETURNING_TITLE = EMAIL_GROUPS[2].title;

export function ClientMessagesEditor({
  initial,
  settingsInitial,
  previewContext,
}: {
  initial: ClientCopy;
  settingsInitial: SettingsMessages;
  previewContext: PreviewContext;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<ClientCopy>(initial);
  const [sDraft, setSDraft] = useState<SettingsMessages>(settingsInitial);
  // Your details open first — it's where someone new starts, and a fresh
  // install carries the original practitioner's name until it's changed here.
  const [openGroup, setOpenGroup] = useState<string | null>(IDENTITY_GROUP.title);
  const [showPages, setShowPages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<TestType | null>(null);
  const spaces = useSpaces();
  const activeSpaces = spaces.filter((sp) => sp.active);
  const [pickedTest, setPickedTest] = useState(activeSpaces[0]?.id ?? "");
  // The space tests use — the first open one if the picked one has been archived.
  const testSpace = activeSpaces.find((sp) => sp.id === pickedTest) ?? activeSpaces[0];
  const testClinic = testSpace?.id ?? "";

  const S_KEYS = Object.keys(settingsInitial) as (keyof SettingsMessages)[];
  const copyDirty = CLIENT_COPY_KEYS.some((k) => draft[k] !== initial[k]);
  const settingsDirty = S_KEYS.some((k) => sDraft[k] !== settingsInitial[k]);
  const dirty = copyDirty || settingsDirty;
  const identity = practitionerIdentity(sDraft);

  const setCopy = (k: keyof ClientCopy, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const setSetting = (k: keyof SettingsMessages, v: string) => setSDraft((d) => ({ ...d, [k]: v }));

  // The composer's view of the draft — editable letter/access/payment/sign-off
  // and wording from here, your spaces and bank details from the last save.
  const previewSettings: EmailSettings = {
    spaces,
    emailTemplate: sDraft.emailTemplate,
    emailTemplateReturning: sDraft.emailTemplateReturning,
    emailSignOff: sDraft.emailSignOff,
    accessNote: sDraft.accessNote,
    paymentDetails: sDraft.paymentDetails,
    practitionerName: sDraft.practitionerName,
    practitionerFullName: sDraft.practitionerFullName,
    practiceName: sDraft.practiceName,
    clientCopy: draft,
    ...previewContext,
  };

  async function saveAll() {
    setSaving(true);
    try {
      // Only send clientCopy fields that differ from the built-in default — a
      // blank/default field stays unstored, so future default tweaks still reach it.
      const clientCopy: Partial<ClientCopy> = {};
      for (const k of CLIENT_COPY_KEYS) {
        if (draft[k].trim() && draft[k].trim() !== CLIENT_COPY_DEFAULTS[k].trim()) clientCopy[k] = draft[k];
      }
      // Settings-backed messages are plain columns — send whichever changed.
      const settingsChanged: Partial<SettingsMessages> = {};
      for (const k of S_KEYS) {
        if (sDraft[k] !== settingsInitial[k]) settingsChanged[k] = sDraft[k];
      }
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ ...settingsChanged, clientCopy }),
      });
      toast("Client messages saved ✓");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  // A test is built from what's SAVED, so it waits until the draft is saved —
  // otherwise "send me this" would send yesterday's wording.
  async function sendTest(type: TestType) {
    setTesting(type);
    try {
      const { sentTo } = await api<{ sentTo: string }>("/api/settings/test-email", {
        method: "POST",
        body: JSON.stringify({ type, clinic: testClinic }),
      });
      toast(`Test sent to ${sentTo} ✓`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send the test");
    } finally {
      setTesting(null);
    }
  }

  function renderField(f: Field) {
    if (f.source === "copy") {
      return (
        <FieldEditor
          key={f.key}
          label={f.label}
          value={draft[f.key]}
          isDefault={draft[f.key].trim() === CLIENT_COPY_DEFAULTS[f.key].trim()}
          placeholders={f.placeholders}
          multiline={f.multiline}
          identity={identity}
          onChange={(v) => setCopy(f.key, v)}
          onReset={() => setCopy(f.key, CLIENT_COPY_DEFAULTS[f.key])}
        />
      );
    }
    const recommended = SETTINGS_MESSAGE_DEFAULTS[f.key];
    return (
      <FieldEditor
        key={f.key}
        label={f.label}
        value={sDraft[f.key]}
        isDefault={recommended !== undefined && sDraft[f.key].trim() === recommended.trim()}
        placeholders={f.placeholders}
        multiline={f.multiline}
        identity={identity}
        noPlaceholders={PLAIN_VALUE_KEYS.has(f.key)}
        onChange={(v) => setSetting(f.key, v)}
        onReset={recommended !== undefined ? () => setSetting(f.key, recommended) : undefined}
      />
    );
  }

  /** One collapsible group — header with when/who badges, its fields, preview and test. */
  function renderGroup(g: Group) {
    const groupEdited = g.fields.some((f) =>
      f.source === "copy"
        ? draft[f.key].trim() !== CLIENT_COPY_DEFAULTS[f.key].trim()
        : sDraft[f.key] !== settingsInitial[f.key],
    );
    const isOpen = openGroup === g.title;
    return (
      <div key={g.title} className="flex flex-col gap-2.5">
        <button
          onClick={() => setOpenGroup(isOpen ? null : g.title)}
          className="flex w-full cursor-pointer items-start justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3 text-left hover:bg-hoverbg"
        >
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold">{g.title}</span>
              {groupEdited && <Badge tone="who">edited</Badge>}
            </span>
            {(g.trigger || g.who) && (
              <span className="flex flex-wrap gap-1.5">
                {g.trigger && <Badge tone={g.trigger === "button" ? "button" : "auto"}>{TRIGGER_LABEL[g.trigger]}</Badge>}
                {g.who && <Badge tone="who">To: {g.who}</Badge>}
              </span>
            )}
          </span>
          <span className="flex-none pt-0.5 text-[11px] font-semibold text-clay-text">{isOpen ? "Hide ▾" : "Edit ›"}</span>
        </button>

        {isOpen && (
          <Card className="flex flex-col gap-4 px-4 py-4">
            {g.when && (
              <p className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
                <strong>When it goes out:</strong> {g.when}
              </p>
            )}
            <p className="text-[12px] leading-relaxed text-muted">{g.blurb}</p>
            {g.fields.map(renderField)}
            {g.title === WELCOME_TITLE && <WelcomeEmailPreview settings={previewSettings} start="first" />}
            {g.title === RETURNING_TITLE && <WelcomeEmailPreview settings={previewSettings} start="returning" />}
            {g.test && (
              <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                <OutlineButton disabled={dirty || testing !== null} onClick={() => sendTest(g.test!)}>
                  {testing === g.test ? "Sending…" : "Send me a test of this email"}
                </OutlineButton>
                <span className="text-[11px] text-muted">
                  {dirty
                    ? "Save your changes first — the test is built from what's saved."
                    : `Goes to your own inbox, with a sample client at ${testSpace?.name ?? "your space"}.`}
                </span>
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  // Drop the recommended wording into the draft. Asks first, since it replaces
  // every message; doesn't save on its own — review it, then Save (or Discard).
  function fillRecommended() {
    const ok = window.confirm(
      "Replace the wording of every message with the recommended wording?\n\nYour name, your spaces and bank details are kept. Nothing is saved until you press Save — Discard undoes it.",
    );
    if (!ok) return;
    setDraft({ ...CLIENT_COPY_DEFAULTS });
    setSDraft((d) => ({ ...d, ...SETTINGS_MESSAGE_DEFAULTS }));
    setOpenGroup(WELCOME_TITLE);
    toast("Recommended wording filled in — review below, then Save");
  }

  const tab = (active: boolean) =>
    `cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ${
      active ? "bg-clay-text text-white" : "bg-[oklch(0.94_0.01_80)] text-muted hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-2.5">
      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <div className="text-[12.5px] leading-relaxed text-muted">
          Every email a client gets from you, in the order they meet them. Each one shows{" "}
          <strong>when it goes out</strong>, <strong>who gets it</strong>, and whether it{" "}
          <Badge tone="auto">Sends itself</Badge> or waits until{" "}
          <Badge tone="button">You press a button</Badge>. Open one, write it your way, and press Save. Words in{" "}
          {"{ }"} fill themselves in — open “Insert a detail” under any box to see what each one becomes.
        </div>
        {activeSpaces.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-[11.5px] text-muted">
            <span>Tests use a sample client at</span>
            {activeSpaces.map((sp) => (
              <button key={sp.id} className={tab(testClinic === sp.id)} onClick={() => setPickedTest(sp.id)}>
                {sp.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      <SubHeading>Start here</SubHeading>
      {renderGroup(IDENTITY_GROUP)}

      <SubHeading>The emails clients get</SubHeading>
      {EMAIL_GROUPS.map(renderGroup)}

      <SubHeading>Written once, used in all of them</SubHeading>
      {BUILDING_BLOCK_GROUPS.map(renderGroup)}

      <button
        onClick={() => setShowPages(!showPages)}
        className="mt-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-dashed border-line bg-transparent px-4 py-3 text-left hover:bg-hoverbg"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-ink-soft">Wording on the pages clients open</span>
          <span className="text-[11.5px] text-muted">
            The intake form, your booking page, the “you&apos;re booked” screen. Set once — you rarely need these.
          </span>
        </span>
        <span className="flex-none text-[11px] font-semibold text-clay-text">{showPages ? "Hide ▾" : "Show ›"}</span>
      </button>
      {showPages && PAGE_GROUPS.map(renderGroup)}

      <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-dashed border-line px-4 py-3">
        <OutlineButton onClick={fillRecommended} className="self-start">
          Start over with the recommended wording
        </OutlineButton>
        <p className="text-[11.5px] text-muted">
          Replaces every message with clean starting wording (it asks first). Nothing is saved until you press Save.
        </p>
      </div>

      {dirty && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-full border border-line bg-card px-3 py-2 shadow-card">
          <PrimaryButton onClick={saveAll} disabled={saving} className="px-4 py-1.5 text-[12.5px]">
            {saving ? "Saving…" : "Save changes"}
          </PrimaryButton>
          <button
            onClick={() => {
              setDraft(initial);
              setSDraft(settingsInitial);
            }}
            className="cursor-pointer text-[12px] font-semibold text-muted underline hover:text-ink"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
