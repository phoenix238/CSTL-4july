"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, PrimaryButton, useToast } from "./ui";
import { CLIENT_COPY_DEFAULTS, CLIENT_COPY_KEYS, applyCopy, type ClientCopy } from "@/lib/clientCopy";
import { composeBookingEmail, type EmailSettings } from "@/lib/booking/email";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

// The saved clinic + bank settings the exact-email preview needs but doesn't edit
// here (addresses live under Map Pin, bank details under Client Pages). The preview
// reads the editable parts (letter, access note, payment, sign-off) live from the
// draft, and these from the last save.
export interface PreviewContext {
  waterlooAddress: string;
  bethnalAddress: string;
  waterlooLocationUrl: string;
  bethnalLocationUrl: string;
  waterlooFindIt: string;
  bethnalFindIt: string;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  bankPaymentNote: string;
}

// The settings-backed messages (plain AppSettings columns, not part of clientCopy)
// that also belong in "every word a client reads" — so this one editor genuinely
// holds all of them instead of leaving the welcome/access/payment/review scattered
// in separate Settings dropdowns.
export interface SettingsMessages {
  emailTemplate: string;
  emailTemplateReturning: string;
  emailSignOff: string;
  accessNote: string;
  paymentDetails: string;
  /** the review wording, written once for both clinics */
  reviewEmailSubject: string;
  reviewEmailBody: string;
  /** the only part of the review email that differs per clinic */
  mapsReviewUrlWaterloo: string;
  mapsReviewUrlBethnal: string;
}

type CopyField = { key: keyof ClientCopy; label: string; multiline?: boolean; placeholders?: string[] };
type SettingsField = { key: keyof SettingsMessages; label: string; multiline?: boolean; placeholders?: string[] };
// A group is backed by either the clientCopy blob or the settings columns.
type Group =
  | { title: string; blurb: string; source: "copy"; fields: CopyField[] }
  | { title: string; blurb: string; source: "settings"; fields: SettingsField[] };

// The emails you actually send, in the order a client meets them. These are the
// ones worth reading through; the page wording below is set-and-forget.
const EMAIL_GROUPS: Group[] = [
  {
    title: "1 · The offer email — “here are some times”",
    blurb: "Sent when you offer a few times. The times you picked drop into {times}, and the link lets them book one themselves.",
    source: "copy",
    fields: [
      { key: "offerEmailSubject", label: "Subject", placeholders: ["clinic"] },
      { key: "offerEmailBody", label: "Message", multiline: true, placeholders: ["name", "clinic", "times", "pickLink"] },
      { key: "offerPickLinkLine", label: "The self-book link line", multiline: true, placeholders: ["link"] },
    ],
  },
  {
    title: "2 · The welcome email — a new client's first booking",
    blurb:
      "Sent the moment you book someone for the first time. Write the words; the address, map pin, how to find the door, payment details, their booking page, the intake link and your sign-off are all placed around it for whichever clinic they booked.",
    source: "settings",
    fields: [
      {
        key: "emailTemplate",
        label: "Welcome message",
        multiline: true,
        placeholders: ["name", "when", "clinic", "price", "accessNote", "intakeLink"],
      },
    ],
  },
  {
    title: "3 · The returning confirmation — every booking after that",
    blurb:
      "The short one, for someone who already has their booking page and knows how to pay. The address, map pin, how to find the door and your sign-off are added underneath, same as the welcome email.",
    source: "settings",
    fields: [
      {
        key: "emailTemplateReturning",
        label: "Returning confirmation",
        multiline: true,
        placeholders: ["name", "when", "clinic", "price"],
      },
    ],
  },
  {
    title: "4 · The intake email — a resend, on its own",
    blurb: "The intake link already rides along in the welcome email; this is the standalone resend.",
    source: "copy",
    fields: [
      { key: "intakeEmailSubject", label: "Subject" },
      { key: "intakeEmailBody", label: "Message", multiline: true, placeholders: ["name", "link"] },
    ],
  },
  {
    title: "5 · The review email — after a session",
    blurb:
      "Asks for a Google review and offers a one-tap marketing opt-in. Written once for both clinics — only the review link differs, because each clinic is its own Google listing.",
    source: "settings",
    fields: [
      { key: "reviewEmailSubject", label: "Subject" },
      { key: "reviewEmailBody", label: "Message", multiline: true, placeholders: ["name", "mapsUrl", "optInLink"] },
      { key: "mapsReviewUrlWaterloo", label: "Google review link — Waterloo" },
      { key: "mapsReviewUrlBethnal", label: "Google review link — Bethnal Green" },
    ],
  },
];

// Written once, dropped into the emails above — not messages in their own right.
const BUILDING_BLOCK_GROUPS: Group[] = [
  {
    title: "The access note",
    blurb:
      "Slots into the welcome email wherever you put {accessNote} — stairs, access needs. Don't paste map links in here; the map pin is added for you from Settings › Where each clinic is.",
    source: "settings",
    fields: [{ key: "accessNote", label: "Access note", multiline: true }],
  },
  {
    title: "Payment wording",
    blurb:
      "Added to the welcome email when you tick “include payment details”. Your account name, sort code, account number and the client's reference are added under it automatically — set those in Settings › Client pages.",
    source: "settings",
    fields: [{ key: "paymentDetails", label: "Payment details", multiline: true }],
  },
  {
    title: "Your sign-off",
    blurb:
      "How every email ends. Written once here and added to the very end of each one — so you don't sign off inside the letters above, and no email ever ends twice.",
    source: "settings",
    fields: [{ key: "emailSignOff", label: "Sign-off", multiline: true }],
  },
];

// The wording on the pages a client opens, rather than the emails they're sent.
// Set once and rarely touched, so it sits behind its own toggle instead of
// doubling the length of the list you scroll through to reach the emails.
const PAGE_GROUPS: Group[] = [
  {
    title: "The intake form page",
    blurb: "What a client sees when they open their intake link.",
    source: "copy",
    fields: [
      { key: "intakePageTitle", label: "Heading" },
      { key: "intakePageIntro", label: "Intro paragraph", multiline: true },
      { key: "intakeEmailHelp", label: "Note under the email field" },
      { key: "intakeThanksTitle", label: "Thank-you heading" },
      { key: "intakeThanksBody", label: "Thank-you message", multiline: true },
    ],
  },
  {
    title: "Your booking page (/book)",
    blurb: "The public page you can link from Instagram or your website.",
    source: "copy",
    fields: [
      { key: "bookPageTitle", label: "Heading" },
      { key: "bookPageIntro", label: "Intro paragraph", multiline: true },
    ],
  },
  {
    title: "The “you're booked” screen",
    blurb: "Shown right after a client books — on /book and via a self-book link.",
    source: "copy",
    fields: [
      { key: "confirmTitle", label: "Heading" },
      { key: "confirmBodySent", label: "Message (email went out)", multiline: true, placeholders: ["emailLine"] },
      { key: "confirmBodyPending", label: "Message (email didn't send)", multiline: true },
      { key: "confirmIntakeCardTitle", label: "Intake card heading" },
      { key: "confirmIntakeCardBody", label: "Intake card message", multiline: true },
      {
        key: "confirmReturningNote",
        label: "Returning client (no intake form needed)",
        multiline: true,
      },
    ],
  },
  {
    title: "The offer-pick page",
    blurb: "What a client sees on the self-book link before choosing a time.",
    source: "copy",
    fields: [
      { key: "offerPickTitle", label: "Heading", placeholders: ["name"] },
      { key: "offerPickIntro", label: "Intro", placeholders: ["clinic"] },
    ],
  },
];

/** Every group, for the reset/fill-everything buttons that walk all fields. */
const GROUPS: Group[] = [...EMAIL_GROUPS, ...BUILDING_BLOCK_GROUPS, ...PAGE_GROUPS];

// Recommended wording for the settings-backed message fields — the clean,
// voice-only starting point the composer is built around (facts placed for you,
// signed once). Used by the per-field reset and the "fill everything" button.
// Deliberately excludes the map-review LINKS, which are yours to paste in.
const SETTINGS_MESSAGE_DEFAULTS: Partial<Record<keyof SettingsMessages, string>> = {
  emailTemplate:
    "Hi {name},\n\nLovely to hear from you — you're booked in for {when} at {clinic}, {price}. Everything you need for the day is below; there's nothing to print or bring.\n\n{accessNote}",
  emailTemplateReturning: "Hi {name},\n\nJust confirming your next session: {when} at {clinic}.",
  emailSignOff: "with gratitude\nPhoenix",
  accessNote:
    "My treatment space has no step-free access at either location — there are stairs. Please let me know if mobility or access is a concern and I'll do my best to accommodate you.",
  paymentDetails: "You can pay on the day by card, or by bank transfer using the details below.",
  reviewEmailSubject: "How was your session?",
  reviewEmailBody:
    "Hi {name},\n\nIt was lovely to see you. I really hope your session landed well.\n\nIf you have a moment, a short Google review means the world to a small practice like mine:\n{mapsUrl}\n\nAnd if you'd like the occasional email about offers and clinic news, you can opt in here (one tap, no obligation):\n{optInLink}\n\nwith gratitude\nPhoenix",
};

// Sample values so the preview reads like a real message.
const SAMPLE: Record<string, string> = {
  name: "Maya",
  clinic: "Bethnal Green",
  times: "  • Tuesday 5 August at 14:00\n  • Thursday 7 August at 10:30",
  link: "https://your-site/offer/ab12cd",
  pickLink: "Or click here to pick one yourself and it'll be booked straight away:\nhttps://your-site/offer/ab12cd\n\n",
  emailLine: " to maya@example.com",
  accessNote: "There are stairs — please let me know about any access needs.",
  intakeLink: "https://your-site/intake/ab12cd",
  mapsUrl: "https://g.page/r/your-review-link",
  optInLink: "https://your-site/preferences/ab12cd",
};

// One editable field with its reset control, placeholders and live preview.
function FieldEditor({
  label,
  value,
  isDefault,
  placeholders,
  multiline,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  isDefault: boolean;
  placeholders?: string[];
  multiline?: boolean;
  onChange: (v: string) => void;
  onReset?: () => void;
}) {
  const preview = value.includes("{") ? applyCopy(value, SAMPLE) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink-soft">{label}</span>
        {onReset && !isDefault && (
          <button
            onClick={onReset}
            className="cursor-pointer text-[11px] font-semibold text-muted underline hover:text-ink"
          >
            Reset to default
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[96px] w-full resize-y rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] leading-[1.55] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
        />
      )}
      {placeholders?.length ? (
        <div className="flex flex-wrap gap-1 text-[10.5px] text-muted">
          {placeholders.map((p) => (
            <code key={p} className="rounded bg-[oklch(0.94_0.01_80)] px-1.5 py-[1px]">{`{${p}}`}</code>
          ))}
        </div>
      ) : null}
      {preview && (
        <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2 text-[12px] leading-[1.55] whitespace-pre-line text-[oklch(0.45_0.02_60)]">
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
  const [clinic, setClinic] = useState<Clinic>("bethnal");
  const [which, setWhich] = useState<"first" | "returning">(start);
  const links = {
    intakeLink: "https://your-site/intake/ab12cd",
    portalLink: "https://your-site/me/ab12cd",
    paymentRef: "MAYA-4K2",
    calendarIcsUrl: "https://your-site/api/portal/ab12cd/ics",
  };
  const email = composeBookingEmail(
    { name: "Maya", welcomeSent: which === "returning" },
    clinic,
    "Fri 14 Aug · 12:15",
    true,
    settings,
    links,
  );
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
      <div className="flex gap-1.5">
        {(["bethnal", "waterloo"] as Clinic[]).map((c) => (
          <button key={c} className={tab(clinic === c)} onClick={() => setClinic(c)}>
            {CLINIC_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2.5">
        <div className="border-b border-line pb-1.5 text-[12px] font-semibold text-ink">{email.subject}</div>
        <div className="whitespace-pre-line pt-2 text-[12px] leading-[1.55] text-[oklch(0.4_0.02_60)]">
          {email.body}
        </div>
      </div>
      <p className="text-[10.5px] text-faint">
        Sample data (Maya, a Bethnal Green session). {which === "first" ? "A new" : "A returning"} client sees this —
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

// The two groups that get the live email preview under them, each opening on
// the matching tab — so "what does a returning client actually get" is answered
// in the same place you edit it.
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [showPages, setShowPages] = useState(false);
  const [saving, setSaving] = useState(false);

  const S_KEYS = Object.keys(settingsInitial) as (keyof SettingsMessages)[];
  const copyDirty = CLIENT_COPY_KEYS.some((k) => draft[k] !== initial[k]);
  const settingsDirty = S_KEYS.some((k) => sDraft[k] !== settingsInitial[k]);
  const dirty = copyDirty || settingsDirty;

  const setCopy = (k: keyof ClientCopy, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const setSetting = (k: keyof SettingsMessages, v: string) => setSDraft((d) => ({ ...d, [k]: v }));

  // The composer's view of the draft — editable letter/access/payment/sign-off
  // from here, the rest of the clinic + bank details from the last save.
  const previewSettings: EmailSettings = {
    emailTemplate: sDraft.emailTemplate,
    emailTemplateReturning: sDraft.emailTemplateReturning,
    emailSignOff: sDraft.emailSignOff,
    accessNote: sDraft.accessNote,
    paymentDetails: sDraft.paymentDetails,
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

  /** One collapsible group — header, its fields, and the preview where it belongs. */
  function renderGroup(g: Group) {
    const groupEdited =
      g.source === "copy"
        ? g.fields.some((f) => draft[f.key].trim() !== CLIENT_COPY_DEFAULTS[f.key].trim())
        : g.fields.some((f) => sDraft[f.key] !== settingsInitial[f.key]);
    const isOpen = openGroup === g.title;
    return (
      <div key={g.title} className="flex flex-col gap-2.5">
        <button
          onClick={() => setOpenGroup(isOpen ? null : g.title)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3 text-left hover:bg-hoverbg"
        >
          <span className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold">{g.title}</span>
            {groupEdited && (
              <span className="rounded-full bg-sage-tint px-2 py-[1px] text-[10.5px] font-semibold text-sage-text">
                edited
              </span>
            )}
          </span>
          <span className="flex-none text-[11px] font-semibold text-clay-text">{isOpen ? "Hide ▾" : "Show ›"}</span>
        </button>

        {isOpen && (
          <Card className="flex flex-col gap-4 px-4 py-4">
            <p className="text-[12px] leading-relaxed text-muted">{g.blurb}</p>
            {g.source === "copy"
              ? g.fields.map((f) => (
                  <FieldEditor
                    key={f.key}
                    label={f.label}
                    value={draft[f.key]}
                    isDefault={draft[f.key].trim() === CLIENT_COPY_DEFAULTS[f.key].trim()}
                    placeholders={f.placeholders}
                    multiline={f.multiline}
                    onChange={(v) => setCopy(f.key, v)}
                    onReset={() => setCopy(f.key, CLIENT_COPY_DEFAULTS[f.key])}
                  />
                ))
              : g.fields.map((f) => {
                  const recommended = SETTINGS_MESSAGE_DEFAULTS[f.key];
                  return (
                    <FieldEditor
                      key={f.key}
                      label={f.label}
                      value={sDraft[f.key]}
                      isDefault={recommended !== undefined && sDraft[f.key].trim() === recommended.trim()}
                      placeholders={f.placeholders}
                      multiline={f.multiline}
                      onChange={(v) => setSetting(f.key, v)}
                      onReset={recommended !== undefined ? () => setSetting(f.key, recommended) : undefined}
                    />
                  );
                })}
            {g.title === WELCOME_TITLE && <WelcomeEmailPreview settings={previewSettings} start="first" />}
            {g.title === RETURNING_TITLE && <WelcomeEmailPreview settings={previewSettings} start="returning" />}
          </Card>
        )}
      </div>
    );
  }

  // Drop the recommended wording into the draft — clean, voice-only, one of
  // everything. Doesn't save on its own: you review it in the preview and Save
  // (or Discard). Your clinic links and bank details aren't touched.
  function fillRecommended() {
    setDraft({ ...CLIENT_COPY_DEFAULTS });
    setSDraft((d) => ({ ...d, ...SETTINGS_MESSAGE_DEFAULTS }));
    setOpenGroup(WELCOME_TITLE);
    toast("Recommended wording filled in — review below, then Save");
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <div className="text-[12.5px] leading-relaxed text-muted">
          Every word a client reads, in one place — from their welcome email to the review request. Open each
          moment of their journey, check it reads the way you want, and edit anything. Placeholders in {"{ }"} fill
          in automatically.
        </div>
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          <PrimaryButton onClick={fillRecommended} className="self-start px-4 py-1.5 text-[12.5px]">
            Fill everything with recommended wording
          </PrimaryButton>
          <p className="text-[11.5px] text-muted">
            Starts you from clean, up-to-date wording — one welcome letter in your voice, one sign-off, tidy payment
            and review emails. Nothing is sent or saved until you press Save; your addresses, map pins and bank
            details aren&apos;t changed. Edit anything afterwards.
          </p>
        </div>
      </Card>

      <SubHeading>The emails you send</SubHeading>
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
