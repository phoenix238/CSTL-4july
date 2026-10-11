"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Card, inputClass, PrimaryButton, SectionLabel, useToast } from "./ui";
import { IntakeQuestionsEditor } from "./IntakeQuestionsEditor";
import { AvailabilitySettings, type AvailabilityOverrideDTO } from "./AvailabilitySettings";
import { ClientMessagesEditor } from "./ClientMessagesEditor";
import { PortalSettings } from "./PortalSettings";
import { PaymentMatching } from "./PaymentMatching";
import { GoogleConnectionPanel } from "./GoogleConnectionPanel";
import { TidyCalendarEventsButton } from "./TidyCalendarEventsButton";
import { TestEmailPanel } from "./TestEmailPanel";
import type { IntakeQuestion } from "@/lib/intakeQuestions";
import type { ClientCopy } from "@/lib/clientCopy";
import type { WeeklyHours } from "@/lib/booking/availability";
import { EVENT_COLORS, type Space } from "@/lib/spaces";
import { SpacesEditor } from "./SpacesEditor";

export interface SettingsData {
  aiModel: string;
  practitionerName: string;
  practitionerFullName: string;
  practiceName: string;
  accessNote: string;
  emailTemplate: string;
  emailTemplateReturning: string;
  emailSignOff: string;
  paymentDetails: string;
  /** a line put on venue calendar events so the venue can reach you */
  clinicContactLine: string;
  appUrl: string;
  personalCalendarId: string;
  googleConnected: boolean;
  /** the last error Google gave a real send — "" when the last one worked */
  googleLastError: string;
  intakeQuestions: IntakeQuestion[];
  reviewEmailSubject: string;
  reviewEmailBody: string;
  // Legacy wording (from when each clinic had its own) — the fallback until the shared pair above is saved.
  reviewEmailSubjectWaterloo: string;
  reviewEmailBodyWaterloo: string;
  weeklyHours: WeeklyHours;
  bookingSlotMinutes: number;
  bookingMinNoticeMins: number;
  bookingHorizonDays: number;
  crossClinicGapMinutes: number;
  bookingNotifyEmail: boolean;
  clientCopy: ClientCopy;
  portalEnabled: boolean;
  portalSelfBook: boolean;
  portalNotifyEmail: boolean;
  portalReceipts: boolean;
  remindNewClientsByDefault: boolean;
  portalNoticeHours: number;
  lateCancelGoodwillPence: number;
  ownReminderMode: string;
  ownReminderMinutesBefore: number;
  ownReminderMorningHour: number;
  venueReminders: boolean;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  bankPaymentNote: string;
  cstaMembershipId: string;
  starlingEnabled: boolean;
  starlingAutoMark: boolean;
  starlingNotifyEmail: boolean;
  starlingLastSyncAt: string | null;
}

/**
 * A stage of the client's journey — groups the sections below it so Settings reads
 * as a story (spaces → booking page → the emails they get → the wiring behind it).
 */
function Stage({ n, title, blurb }: { n: number; title: string; blurb: string }) {
  return (
    <div className="mt-4 flex flex-col gap-1 border-t border-line pt-5 first:mt-0 first:border-0 first:pt-0">
      <div className="flex items-baseline gap-2.5">
        <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-clay text-[11px] font-semibold text-cream">
          {n}
        </span>
        <h2 className="font-serif text-[18px] leading-tight font-medium">{title}</h2>
      </div>
      <p className="pl-[32px] text-[12.5px] leading-[1.6] text-muted">{blurb}</p>
    </div>
  );
}

/** A collapsed-by-default section — click the header to reveal its contents. */
function Dropdown({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-0.5 pt-2 text-left"
      >
        <SectionLabel>{label}</SectionLabel>
        <span className="text-[11px] font-semibold text-clay-text">{open ? "Hide ▾" : "Show ›"}</span>
      </button>
      {open && children}
    </div>
  );
}

export function SettingsView({
  settings,
  overrides,
  clients = [],
  spaces,
}: {
  settings: SettingsData;
  /** every space, with entrance photos — for the spaces editor */
  spaces: Space[];
  overrides: AvailabilityOverrideDTO[];
  clients?: Array<{ id: string; name: string; paymentRef: string }>;
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState("");
  const [editingGoogle, setEditingGoogle] = useState(false);
  const [googleDraft, setGoogleDraft] = useState({
    personalCalendarId: settings.personalCalendarId,
    appUrl: settings.appUrl,
  });

  // Phoenix's own calendar reminders — how he's nudged about his sessions, and
  // whether the venue events nag him too. Saved as their own little form.
  const [reminderDraft, setReminderDraft] = useState({
    ownReminderMode: settings.ownReminderMode,
    ownReminderMinutesBefore: settings.ownReminderMinutesBefore,
    ownReminderMorningHour: settings.ownReminderMorningHour,
    venueReminders: settings.venueReminders,
  });
  const [reminderDirty, setReminderDirty] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);
  const setReminder = <K extends keyof typeof reminderDraft>(key: K, value: (typeof reminderDraft)[K]) => {
    setReminderDraft((p) => ({ ...p, [key]: value }));
    setReminderDirty(true);
  };
  const saveReminders = async () => {
    setSavingReminders(true);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify(reminderDraft) });
      setReminderDirty(false);
      router.refresh();
      toast("Your reminder settings saved ✓");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSavingReminders(false);
    }
  };

  const baseUrl = (settings.appUrl?.trim() || "https://cstl-4july.vercel.app").replace(/\/+$/, "");

  const save = async (data: Record<string, string>, done: () => void, msg: string) => {
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify(data) });
      done();
      router.refresh();
      toast(msg);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  // Spaces whose bookings also go on a venue's own calendar — for the contact
  // line and the Google summary below.
  const venueSpaces = spaces.filter((sp) => sp.active && sp.venueMode !== "none");

  return (
    <div className="flex max-w-[760px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Settings</h1>
      <p className="max-w-[64ch] text-[13.5px] leading-[1.65] text-muted">
        This is where you shape what a client experiences with you — from the first hello to after their
        session. It&apos;s laid out in the order they&apos;ll meet it, so you can read top to bottom and
        picture their whole journey. Everything is tucked into sections — tap one to open it.
      </p>

      {/* ───────────────── 1 · Your spaces ───────────────── */}
      <Stage
        n={1}
        title="Your spaces"
        blurb="Everywhere you see clients — where each one is, what it costs, how to find the door, and what a booking there puts on your calendar. Add a new space any time."
      />

      <Dropdown label="YOUR SPACES" open={open.spaces ?? true} onToggle={() => setOpen((p) => ({ ...p, spaces: !(p.spaces ?? true) }))}>
        <SpacesEditor initial={spaces} />
      </Dropdown>

      <Dropdown
        label="· CONTACT LINE FOR THE VENUES — ON THEIR CALENDAR EVENTS"
        open={!!open.contact}
        onToggle={() => toggle("contact")}
      >
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => {
              if (!editingContact) setContactDraft(settings.clinicContactLine);
              setEditingContact(!editingContact);
            }}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingContact ? "Cancel" : "Edit"}
          </button>
        </div>
        {!editingContact ? (
          <div className="rounded-2xl border border-[oklch(0.87_0.05_48_/_0.5)] bg-[oklch(0.94_0.03_48_/_0.5)] px-[18px] py-3.5 text-[13px] leading-[1.6] whitespace-pre-wrap text-[oklch(0.4_0.06_48)]">
            {settings.clinicContactLine || "Not set — the venue events show the session times only."}
          </div>
        ) : (
          <Card className="flex flex-col gap-2.5 border-[1.5px] border-clay/35 px-4 py-3.5">
            <input
              value={contactDraft}
              onChange={(e) => setContactDraft(e.target.value)}
              placeholder="e.g. Contact me: 07000 000000"
              className="w-full rounded-[10px] border border-line bg-inputbg px-3 py-2.5 text-[13px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
            />
            <PrimaryButton
              onClick={() => save({ clinicContactLine: contactDraft }, () => setEditingContact(false), "Contact line updated ✓")}
              className="self-start px-[18px] py-[9px] text-[13px]"
            >
              Save
            </PrimaryButton>
          </Card>
        )}
        <div className="text-[11.5px] text-muted">
          Added under the session times on the events put on a venue&apos;s own calendar (for spaces set to book the
          venue&apos;s calendar), so the venue can reach you if something changes. Leave blank to show just the times.
          {venueSpaces.length === 0 && " None of your spaces book a venue calendar at the moment, so this isn't used yet."}
        </div>
      </Dropdown>

      {/* ───────────────── 2 · Your booking page ───────────────── */}
      <Stage
        n={2}
        title="Your booking page"
        blurb="The public page a client can use to book themselves in — your weekly hours, day-by-day exceptions, and how far ahead they can book."
      />

      <Dropdown
        label="AVAILABILITY — YOUR PUBLIC BOOKING PAGE"
        open={!!open.availability}
        onToggle={() => toggle("availability")}
      >
        <AvailabilitySettings
          weeklyHours={settings.weeklyHours}
          overrides={overrides}
          bookingSlotMinutes={settings.bookingSlotMinutes}
          bookingMinNoticeMins={settings.bookingMinNoticeMins}
          bookingHorizonDays={settings.bookingHorizonDays}
          crossClinicGapMinutes={settings.crossClinicGapMinutes}
          bookingNotifyEmail={settings.bookingNotifyEmail}
          baseUrl={baseUrl}
        />
      </Dropdown>

      <Dropdown
        label="CLIENT PAGES — PRIVATE LINKS, BANK DETAILS & REFERENCES"
        open={!!open.portal}
        onToggle={() => toggle("portal")}
      >
        <PortalSettings
          initial={{
            portalEnabled: settings.portalEnabled,
            portalSelfBook: settings.portalSelfBook,
            portalNotifyEmail: settings.portalNotifyEmail,
            portalReceipts: settings.portalReceipts,
            remindNewClientsByDefault: settings.remindNewClientsByDefault,
            portalNoticeHours: settings.portalNoticeHours,
            lateCancelGoodwillPence: settings.lateCancelGoodwillPence,
            bankAccountName: settings.bankAccountName,
            bankSortCode: settings.bankSortCode,
            bankAccountNumber: settings.bankAccountNumber,
            bankPaymentNote: settings.bankPaymentNote,
            cstaMembershipId: settings.cstaMembershipId,
          }}
        />
      </Dropdown>

      <Dropdown
        label="PAYMENTS — MATCH BANK TRANSFERS TO SESSIONS"
        open={!!open.payments}
        onToggle={() => toggle("payments")}
      >
        <PaymentMatching
          initial={{
            starlingEnabled: settings.starlingEnabled,
            starlingAutoMark: settings.starlingAutoMark,
            starlingNotifyEmail: settings.starlingNotifyEmail,
            starlingLastSyncAt: settings.starlingLastSyncAt,
          }}
          clients={clients}
        />
      </Dropdown>

      {/* ───────────────── 3 · The messages clients receive ───────────────── */}
      <Stage
        n={3}
        title="The messages clients receive"
        blurb="Every email your clients get, in the order they meet them — each one says when it goes out, who gets it, and whether it sends itself or waits for you to press a button. Write them in your own voice; nothing here is fixed."
      />

      <Dropdown
        label="YOUR NAME & EVERY CLIENT EMAIL — READ AND EDIT"
        open={!!open.clientMessages}
        onToggle={() => toggle("clientMessages")}
      >
        <ClientMessagesEditor
          initial={settings.clientCopy}
          settingsInitial={{
            practitionerName: settings.practitionerName,
            practitionerFullName: settings.practitionerFullName,
            practiceName: settings.practiceName,
            emailTemplate: settings.emailTemplate,
            emailTemplateReturning: settings.emailTemplateReturning,
            emailSignOff: settings.emailSignOff,
            accessNote: settings.accessNote,
            paymentDetails: settings.paymentDetails,
            // The review wording, shared by every space — seeded from the old
            // per-clinic copy if this pair has never been saved, so wording that
            // was only in those boxes isn't silently left behind.
            reviewEmailSubject: settings.reviewEmailSubject || settings.reviewEmailSubjectWaterloo,
            reviewEmailBody: settings.reviewEmailBody || settings.reviewEmailBodyWaterloo,
          }}
          previewContext={{
            bankAccountName: settings.bankAccountName,
            bankSortCode: settings.bankSortCode,
            bankAccountNumber: settings.bankAccountNumber,
            bankPaymentNote: settings.bankPaymentNote,
          }}
        />
      </Dropdown>

      <Dropdown
        label="SEND YOURSELF A TEST EMAIL"
        open={!!open.testEmail}
        onToggle={() => toggle("testEmail")}
      >
        <TestEmailPanel />
      </Dropdown>

      <Dropdown
        label="INTAKE FORM — SENT WITH THE WELCOME EMAIL"
        open={!!open.intakeQuestions}
        onToggle={() => toggle("intakeQuestions")}
      >
        <div className="rounded-xl border border-line bg-inputbg px-4 py-3 text-[12.5px] leading-[1.6] text-muted">
          The intake link now rides along in the welcome email, so a new client gets it in one message. You can also
          resend it any time — the &quot;Send intake form&quot; button appears right after you book someone, and on
          every client&apos;s profile. These are the questions it asks:
        </div>
        <IntakeQuestionsEditor initial={settings.intakeQuestions} />
      </Dropdown>

      {/* ───────────────── 4 · Behind the scenes ───────────────── */}
      <Stage
        n={4}
        title="Behind the scenes"
        blurb="How the app connects to your Google account to create calendar events, save notes to Drive, and send email as you."
      />

      <SectionLabel>AI — CASE NOTES, ENQUIRIES & IMPORT</SectionLabel>
      <Card className="flex flex-col gap-2.5 px-5 py-4">
        <p className="text-[12.5px] leading-[1.6] text-muted">
          Reads new enquiries, turns your dictated notes into bullets, and summarises sessions —
          always called directly against Anthropic, never a third party. Sonnet reads more
          carefully (recommended for case notes); Haiku is faster and a little cheaper.
        </p>
        <div className="flex gap-1.5 rounded-full bg-hoverbg/60 p-1 self-start">
          {(["sonnet", "haiku"] as const).map((m) => (
            <button
              key={m}
              onClick={() => save({ aiModel: m }, () => {}, `AI model set to ${m === "sonnet" ? "Sonnet" : "Haiku"} ✓`)}
              className={`cursor-pointer rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
                (settings.aiModel || "sonnet") === m ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
              }`}
            >
              {m === "sonnet" ? "Sonnet — best quality" : "Haiku — fast & cheap"}
            </button>
          ))}
        </div>
      </Card>

      <Dropdown label="GOOGLE — CALENDAR, DRIVE & GMAIL" open={!!open.google} onToggle={() => toggle("google")}>
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => setEditingGoogle(!editingGoogle)}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingGoogle ? "Cancel" : "Edit"}
          </button>
        </div>
        <GoogleConnectionPanel connected={settings.googleConnected} lastError={settings.googleLastError} />
        {!editingGoogle ? (
          <Card className="px-5 py-1.5">
            <Row label="Client folders & Docs">Drive › CSTL › Clients › (client name)</Row>
            <Row label="Marketing spreadsheet">Drive › CSTL › Clients › Docs</Row>
            <Row label="Intake form">In-app form — {baseUrl}/intake/…</Row>
            <Row label="Personal calendar">{settings.personalCalendarId || "primary"}</Row>
            {venueSpaces.map((sp) => (
              <Row key={sp.id} label={`${sp.name} venue calendar`}>
                {sp.venueCalendarId || `not set — add it in Your spaces › ${sp.name}`}
              </Row>
            ))}
            <Row label="Session colours">
              {spaces
                .filter((sp) => sp.active)
                .map((sp) => `${sp.name} ${EVENT_COLORS[sp.eventColor]?.name.toLowerCase() ?? ""}`)
                .join(" · ")}
            </Row>
            <Row label="Your session reminders" last>
              {settings.ownReminderMode === "morning"
                ? `Popup on the morning of (from ${settings.ownReminderMorningHour}:00)`
                : settings.ownReminderMode === "before"
                  ? `Popup ${settings.ownReminderMinutesBefore} min before`
                  : settings.ownReminderMode === "email_popup"
                    ? "Email 24 h before · popup 1 h before"
                    : "None"}
              {` · venue events ${settings.venueReminders ? "on" : "off"}`}
            </Row>
          </Card>
        ) : (
          <Card className="flex flex-col gap-[11px] border-[1.5px] border-clay/35 px-4 py-3.5">
            {(
              [
                ["personalCalendarId", "PERSONAL CALENDAR ID", '"primary" or a calendar\'s ID from Google Calendar settings'],
                ["appUrl", "APP WEB ADDRESS", "your app's URL (used to build intake links) — e.g. https://cstl-4july.vercel.app"],
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">{label}</span>
                <input
                  value={googleDraft[key]}
                  onChange={(e) => setGoogleDraft({ ...googleDraft, [key]: e.target.value })}
                  className={inputClass}
                />
                <span className="text-[10.5px] text-faint">{hint}</span>
              </label>
            ))}
            <span className="text-[11px] text-muted">
              Each space&apos;s venue calendar and colour are set in Your spaces, at the top of Settings.
            </span>
            <PrimaryButton
              onClick={() => save({ ...googleDraft }, () => setEditingGoogle(false), "Google settings updated ✓")}
              className="self-start px-[18px] py-[9px] text-[13px]"
            >
              Save
            </PrimaryButton>
          </Card>
        )}
        <TidyCalendarEventsButton />
      </Dropdown>

      <SectionLabel className="pt-2">YOUR OWN SESSION REMINDERS</SectionLabel>
      <Card className="flex flex-col gap-3.5 px-5 py-4">
        <p className="text-[12.5px] leading-[1.6] text-muted">
          How Google reminds <span className="font-medium text-ink">you</span> about your own sessions. This only
          changes your reminders — a client&apos;s reminders are always their own, set on their booking page. Takes
          effect on sessions booked or moved from now on.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium text-ink">How you&apos;re reminded</span>
          <select
            value={reminderDraft.ownReminderMode}
            onChange={(e) => setReminder("ownReminderMode", e.target.value)}
            className={inputClass}
          >
            <option value="morning">One popup on the morning of the session</option>
            <option value="before">One popup a set time before</option>
            <option value="email_popup">Email a day before + popup an hour before</option>
            <option value="none">Nothing — I use the Today view</option>
          </select>
        </label>

        {reminderDraft.ownReminderMode === "morning" && (
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-ink">
              Morning popup fires from {reminderDraft.ownReminderMorningHour}:00
            </span>
            <input
              type="range"
              min={5}
              max={11}
              step={1}
              value={reminderDraft.ownReminderMorningHour}
              onChange={(e) => setReminder("ownReminderMorningHour", Number(e.target.value))}
              className="w-full cursor-pointer accent-[oklch(0.58_0.115_42)]"
            />
            <span className="text-[11.5px] leading-[1.5] text-muted">
              A session earlier than this gets an hour-before popup instead (there&apos;s no earlier morning to nudge).
            </span>
          </label>
        )}

        {reminderDraft.ownReminderMode === "before" && (
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-ink">Minutes before the session</span>
            <input
              value={String(reminderDraft.ownReminderMinutesBefore)}
              onChange={(e) => setReminder("ownReminderMinutesBefore", Math.max(0, Number(e.target.value) || 0))}
              inputMode="numeric"
              className={`${inputClass} max-w-[110px]`}
            />
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={reminderDraft.venueReminders}
            onChange={(e) => setReminder("venueReminders", e.target.checked)}
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[12.5px] font-medium text-ink">Also remind me from the venue events</span>
            <span className="text-[11.5px] leading-[1.5] text-muted">
              Off is best — leaving it off is what stops you getting the same reminder twice (once from your session,
              once from the event or shared block put on a venue&apos;s own calendar).
            </span>
          </span>
        </label>

        <PrimaryButton
          onClick={saveReminders}
          disabled={!reminderDirty || savingReminders}
          className="self-start px-4 py-1.5 text-[12.5px]"
        >
          {savingReminders ? "Saving…" : "Save reminder settings"}
        </PrimaryButton>
      </Card>

      <SectionLabel className="pt-2">ADD TO YOUR IPHONE</SectionLabel>
      <Card className="flex flex-col gap-3 px-5 py-4 text-[13px] leading-[1.6] text-[oklch(0.4_0.02_60)]">
        <div>
          <div className="font-semibold text-ink">Install the app</div>
          In Safari, open <span className="font-mono text-[12px]">{baseUrl}</span>, tap the Share icon, then{" "}
          <b>Add to Home Screen</b>. It now opens like a normal app.
        </div>
        <div className="text-[12px] text-muted">
          To bring in a WhatsApp or email enquiry, open <b>Enquiries</b> and use the &quot;Paste a message&quot;
          button — it picks up whatever you last copied.
        </div>
      </Card>
    </div>
  );
}

function Row({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-1 py-[13px] text-[13px] ${last ? "" : "border-b border-hairline"}`}
    >
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right font-semibold break-all">{children}</span>
    </div>
  );
}
