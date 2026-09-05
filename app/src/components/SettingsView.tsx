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

export interface SettingsData {
  aiModel: string;
  accessNote: string;
  emailTemplate: string;
  emailTemplateReturning: string;
  emailSignOff: string;
  paymentDetails: string;
  waterlooAddress: string;
  bethnalAddress: string;
  clinicContactLine: string;
  waterlooLocationUrl: string;
  bethnalLocationUrl: string;
  waterlooFindIt: string;
  bethnalFindIt: string;
  // Superseded by waterlooFindIt/bethnalFindIt — shown read-only when the new
  // field is still empty, so there's something to copy from rather than a blank box.
  waterlooDirections: string;
  bethnalDirections: string;
  waterlooArrivalNote: string;
  bethnalArrivalNote: string;
  waterlooPhoto: string;
  bethnalPhoto: string;
  appUrl: string;
  personalCalendarId: string;
  roomCalendarId: string;
  chalkFarmCalendarId: string;
  googleConnected: boolean;
  /** the last error Google gave a real send — "" when the last one worked */
  googleLastError: string;
  intakeQuestions: IntakeQuestion[];
  mapsReviewUrlWaterloo: string;
  mapsReviewUrlBethnal: string;
  reviewEmailSubject: string;
  reviewEmailBody: string;
  // Legacy per-clinic wording — the fallback until the shared pair above is saved.
  reviewEmailSubjectWaterloo: string;
  reviewEmailSubjectBethnal: string;
  reviewEmailBodyWaterloo: string;
  reviewEmailBodyBethnal: string;
  weeklyHours: WeeklyHours;
  bookingSlotMinutes: number;
  bookingMinNoticeMins: number;
  bookingHorizonDays: number;
  bookingBufferMinutes: number;
  bethnalBufferMinutes: number;
  chalkFarmBufferMinutes: number;
  chalkFarmEdgeBufferMinutes: number;
  chalkFarmClusterGapMinutes: number;
  chalkFarmWeeklyCapHours: number;
  crossClinicGapMinutes: number;
  bookingNotifyEmail: boolean;
  clientCopy: ClientCopy;
  portalEnabled: boolean;
  portalSelfBook: boolean;
  portalNotifyEmail: boolean;
  portalReceipts: boolean;
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
  starlingEnabled: boolean;
  starlingAutoMark: boolean;
  starlingNotifyEmail: boolean;
  starlingLastSyncAt: string | null;
}

/**
 * A stage of the client's journey — groups the sections below it so Settings reads
 * as a story (clinics → booking page → the emails they get → the wiring behind it).
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
}: {
  settings: SettingsData;
  overrides: AvailabilityOverrideDTO[];
  clients?: Array<{ id: string; name: string; paymentRef: string }>;
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState("");
  const [editingLocations, setEditingLocations] = useState(false);
  // The wording still saved in the old direction/arrival-note fields the "How to
  // find it" box replaced — joined the same way the email composer joins them, so
  // what's shown here is exactly what's still going out until it's copied over.
  const legacyFindIt = (clinic: "waterloo" | "bethnal") =>
    [
      clinic === "waterloo" ? settings.waterlooDirections : settings.bethnalDirections,
      clinic === "waterloo" ? settings.waterlooArrivalNote : settings.bethnalArrivalNote,
    ]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");
  // Everything about where a clinic is, in one draft — address, map pin, how to
  // find the door, entrance photo. These used to be two dropdowns under two
  // different headings, which is how a map link ended up pasted into the access
  // note instead: the box that said "arrival notes" on the label didn't contain one.
  const [locationsDraft, setLocationsDraft] = useState({
    waterlooAddress: settings.waterlooAddress,
    bethnalAddress: settings.bethnalAddress,
    waterlooLocationUrl: settings.waterlooLocationUrl,
    bethnalLocationUrl: settings.bethnalLocationUrl,
    waterlooFindIt: settings.waterlooFindIt,
    bethnalFindIt: settings.bethnalFindIt,
    waterlooPhoto: settings.waterlooPhoto,
    bethnalPhoto: settings.bethnalPhoto,
  });
  const [editingGoogle, setEditingGoogle] = useState(false);
  const [googleDraft, setGoogleDraft] = useState({
    personalCalendarId: settings.personalCalendarId,
    roomCalendarId: settings.roomCalendarId,
    chalkFarmCalendarId: settings.chalkFarmCalendarId,
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

  const copyLocation = async (clinic: "waterloo" | "bethnal") => {
    const address = clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
    const url = clinic === "waterloo" ? settings.waterlooLocationUrl : settings.bethnalLocationUrl;
    const directions = clinic === "waterloo" ? settings.waterlooFindIt : settings.bethnalFindIt;
    // Address, map link, then the directions (their own line breaks kept), each
    // separated by a blank line — reads cleanly pasted into WhatsApp or an email,
    // and matches the order the confirmation email puts them in.
    const text = [address, url, directions].map((p) => p?.trim()).filter(Boolean).join("\n\n");
    if (!text) {
      toast("Nothing to copy yet — add an address, map pin or directions first");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(`${clinic === "waterloo" ? "Waterloo" : "Bethnal Green"} location & directions copied ✓`);
    } catch {
      toast("Couldn't copy — try again");
    }
  };

  return (
    <div className="flex max-w-[760px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Settings</h1>
      <p className="max-w-[64ch] text-[13.5px] leading-[1.65] text-muted">
        This is where you shape what a client experiences with you — from the first hello to after their
        session. It&apos;s laid out in the order they&apos;ll meet it, so you can read top to bottom and
        picture their whole journey. Everything is tucked into sections — tap one to open it.
      </p>

      {/* ───────────────── 1 · Your two clinics ───────────────── */}
      <Stage
        n={1}
        title="Your two clinics"
        blurb="The basics of each space — where it is, and what a booking there puts on your calendar."
      />

      <SectionLabel>WHAT EACH BOOKING CREATES</SectionLabel>
      <Card className="px-5 py-1.5">
        <div className="border-b border-hairline py-[15px]">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-base font-medium">Bethnal Green</span>
            <span className="text-xs font-semibold text-sage-text">£30–60 sliding · 60 min</span>
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-[oklch(0.5_0.02_58)]">
            Creates the 1-hour &quot;(Client) — Bethnal Green&quot; personal event, and keeps one shared
            &quot;Phoenix&quot; block on the Chalk Farm calendar in sync — it grows and shrinks to span that
            day&apos;s sessions, so clients can be booked close together. The block&apos;s note tells the venue
            how many sessions and when, without any client names.
          </div>
        </div>
        <div className="py-[15px]">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-base font-medium">Waterloo</span>
            <span className="text-xs font-semibold text-clay-text">£80 · 60 min</span>
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-[oklch(0.5_0.02_58)]">
            Creates two 1-hour events: &quot;(Client) — Waterloo&quot; on your personal calendar + &quot;R5 -
            Phoenix&quot; on the room calendar. The room event&apos;s note carries the session time and your
            contact line — the client&apos;s name stays off the shared room calendar.
          </div>
        </div>
      </Card>

      <Dropdown
        label="· CONTACT LINE FOR THE CLINICS — ON THE ROOM / CHALK FARM EVENTS"
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
              placeholder="e.g. Contact Phoenix: 07000 000000"
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
          Added under the session times on the &quot;R5 - Phoenix&quot; and shared &quot;Phoenix&quot; venue
          events, so a clinic can reach you if something changes. Leave blank to show just the times.
        </div>
      </Dropdown>

      <Dropdown label="WHERE EACH CLINIC IS" open={!!open.locations} onToggle={() => toggle("locations")}>
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => {
              if (!editingLocations) {
                setLocationsDraft({
                  waterlooAddress: settings.waterlooAddress,
                  bethnalAddress: settings.bethnalAddress,
                  waterlooLocationUrl: settings.waterlooLocationUrl,
                  bethnalLocationUrl: settings.bethnalLocationUrl,
                  waterlooFindIt: settings.waterlooFindIt,
                  bethnalFindIt: settings.bethnalFindIt,
                  waterlooPhoto: settings.waterlooPhoto,
                  bethnalPhoto: settings.bethnalPhoto,
                });
              }
              setEditingLocations(!editingLocations);
            }}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingLocations ? "Cancel" : "Edit"}
          </button>
        </div>
        {!editingLocations ? (
          <Card className="flex flex-col gap-3.5 px-5 py-4">
            {(
              [
                [
                  "waterloo",
                  "Waterloo",
                  settings.waterlooAddress,
                  settings.waterlooLocationUrl,
                  settings.waterlooFindIt,
                  settings.waterlooPhoto,
                ],
                [
                  "bethnal",
                  "Bethnal Green",
                  settings.bethnalAddress,
                  settings.bethnalLocationUrl,
                  settings.bethnalFindIt,
                  settings.bethnalPhoto,
                ],
              ] as const
            ).map(([clinic, label, address, url, directions, photo], i) => (
              <div key={clinic} className={`flex flex-col gap-2 ${i === 0 ? "border-b border-hairline pb-3.5" : ""}`}>
                <div className="flex items-center justify-between gap-2.5">
                  <span className="font-serif text-[15px] font-medium">{label}</span>
                  <button
                    onClick={() => copyLocation(clinic)}
                    className="cursor-pointer rounded-full bg-clay-tint px-3.5 py-1.5 text-[12px] font-semibold text-clay-text hover:opacity-90"
                  >
                    Copy address &amp; directions
                  </button>
                </div>
                <div className="text-[12.5px] leading-[1.55] text-[oklch(0.45_0.02_58)]">
                  <span className="font-semibold">Address: </span>
                  {address || <span className="text-faint">not set yet</span>}
                </div>
                <div className="text-[12.5px] leading-[1.55] text-[oklch(0.45_0.02_58)]">
                  <span className="font-semibold">Map pin: </span>
                  {url ? <span className="break-all">{url}</span> : <span className="text-faint">not set yet</span>}
                </div>
                <div className="text-[12.5px] leading-[1.55] whitespace-pre-line text-[oklch(0.45_0.02_58)]">
                  <span className="font-semibold">How to find it: </span>
                  {directions || (
                    <span className="text-faint">
                      not set yet
                      {legacyFindIt(clinic) && " — open Edit below to see the old wording still going out"}
                    </span>
                  )}
                </div>
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo}
                    alt={`The entrance at ${label}`}
                    className="max-h-[150px] w-fit rounded-lg border border-line object-cover"
                  />
                )}
              </div>
            ))}
          </Card>
        ) : (
          <Card className="flex flex-col gap-[18px] border-[1.5px] border-clay/35 px-4 py-3.5">
            {(
              [
                ["Waterloo", "waterlooAddress", "waterlooLocationUrl", "waterlooFindIt", "waterlooPhoto", "waterloo"],
                ["Bethnal Green", "bethnalAddress", "bethnalLocationUrl", "bethnalFindIt", "bethnalPhoto", "bethnal"],
              ] as const
            ).map(([clinicLabel, addrKey, urlKey, dirKey, photoKey, clinic], i) => (
              <div
                key={clinic}
                className={`flex flex-col gap-[11px] ${i === 0 ? "border-b border-hairline pb-[18px]" : ""}`}
              >
                <div className="font-serif text-[15px] font-medium">{clinicLabel}</div>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    ADDRESS
                  </span>
                  <input
                    value={locationsDraft[addrKey]}
                    onChange={(e) => setLocationsDraft({ ...locationsDraft, [addrKey]: e.target.value })}
                    placeholder="The full street address, as you'd write it on an envelope."
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    MAP PIN
                  </span>
                  <input
                    value={locationsDraft[urlKey]}
                    onChange={(e) => setLocationsDraft({ ...locationsDraft, [urlKey]: e.target.value })}
                    placeholder="A Google Maps pin / share link, what3words, etc."
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    HOW TO FIND IT
                  </span>
                  <textarea
                    value={locationsDraft[dirKey]}
                    onChange={(e) => setLocationsDraft({ ...locationsDraft, [dirKey]: e.target.value })}
                    placeholder="Buzzer code, which door, the nearest station, where to wait — whatever helps a client find you."
                    className="min-h-[70px] w-full resize-y rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
                  />
                </label>
                {!locationsDraft[dirKey].trim() && legacyFindIt(clinic) && (
                  <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2.5 text-[12px] leading-[1.55] text-[oklch(0.45_0.02_60)]">
                    <div className="mb-1 font-semibold text-ink-soft">
                      Still going out — from the old fields this box replaces:
                    </div>
                    <div className="whitespace-pre-line">{legacyFindIt(clinic)}</div>
                    <button
                      onClick={() => setLocationsDraft({ ...locationsDraft, [dirKey]: legacyFindIt(clinic) })}
                      className="mt-1.5 cursor-pointer text-[11.5px] font-semibold text-clay-text underline hover:text-clay"
                    >
                      Use this wording — then edit or trim it above
                    </button>
                  </div>
                )}
                <PhotoField
                  label="PHOTO OF THE ENTRANCE"
                  clinicLabel={clinicLabel}
                  value={locationsDraft[photoKey]}
                  onChange={(v) => setLocationsDraft({ ...locationsDraft, [photoKey]: v })}
                  onError={toast}
                />
              </div>
            ))}
            <PrimaryButton
              onClick={() => save({ ...locationsDraft }, () => setEditingLocations(false), "Clinic locations updated ✓")}
              className="self-start px-[18px] py-[9px] text-[13px]"
            >
              Save
            </PrimaryButton>
          </Card>
        )}
        <div className="text-[11.5px] leading-[1.6] text-muted">
          These four go out together, in this order, in every confirmation email and on the public booking page. The
          address is also the location on the calendar invite. You don&apos;t need to paste a map link into any of your
          messages — it&apos;s added from here, for whichever clinic they booked.
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
          bookingBufferMinutes={settings.bookingBufferMinutes}
          bethnalBufferMinutes={settings.bethnalBufferMinutes}
          chalkFarmBufferMinutes={settings.chalkFarmBufferMinutes}
          chalkFarmEdgeBufferMinutes={settings.chalkFarmEdgeBufferMinutes}
          chalkFarmClusterGapMinutes={settings.chalkFarmClusterGapMinutes}
          chalkFarmWeeklyCapHours={settings.chalkFarmWeeklyCapHours}
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
            portalNoticeHours: settings.portalNoticeHours,
            lateCancelGoodwillPence: settings.lateCancelGoodwillPence,
            bankAccountName: settings.bankAccountName,
            bankSortCode: settings.bankSortCode,
            bankAccountNumber: settings.bankAccountNumber,
            bankPaymentNote: settings.bankPaymentNote,
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
        blurb="Every word a client reads, in one place — the welcome email, offer, intake, booking pages, confirmations and the review request. Walk through them, check each one sounds like you, and edit anything."
      />

      <Dropdown
        label="ALL CLIENT MESSAGES — REVIEW & EDIT EVERY WORD"
        open={!!open.clientMessages}
        onToggle={() => toggle("clientMessages")}
      >
        <ClientMessagesEditor
          initial={settings.clientCopy}
          settingsInitial={{
            emailTemplate: settings.emailTemplate,
            emailTemplateReturning: settings.emailTemplateReturning,
            emailSignOff: settings.emailSignOff,
            accessNote: settings.accessNote,
            paymentDetails: settings.paymentDetails,
            // The review wording, shared by both clinics — seeded from the old
            // Waterloo copy if this pair has never been saved, so wording that
            // was only in the per-clinic boxes isn't silently left behind.
            reviewEmailSubject: settings.reviewEmailSubject || settings.reviewEmailSubjectWaterloo,
            reviewEmailBody: settings.reviewEmailBody || settings.reviewEmailBodyWaterloo,
            mapsReviewUrlWaterloo: settings.mapsReviewUrlWaterloo,
            mapsReviewUrlBethnal: settings.mapsReviewUrlBethnal,
          }}
          previewContext={{
            waterlooAddress: settings.waterlooAddress,
            bethnalAddress: settings.bethnalAddress,
            waterlooLocationUrl: settings.waterlooLocationUrl,
            bethnalLocationUrl: settings.bethnalLocationUrl,
            waterlooFindIt: settings.waterlooFindIt,
            bethnalFindIt: settings.bethnalFindIt,
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
            <Row label="R5 room calendar">{settings.roomCalendarId || "not set — needed for Waterloo bookings"}</Row>
            <Row label="Chalk Farm calendar">
              {settings.chalkFarmCalendarId || "not set — needed for Bethnal Green bookings"}
            </Row>
            <Row label="Session colours">Bethnal Green pink · Waterloo orange</Row>
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
                ["roomCalendarId", "R5 ROOM CALENDAR ID", "the room calendar's ID (Waterloo bookings)"],
                ["chalkFarmCalendarId", "CHALK FARM CALENDAR ID", "the Chalk Farm calendar's ID (Bethnal Green blocks)"],
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
              once from the &quot;R5 - Phoenix&quot; room event or the shared Chalk Farm block).
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

/** Longest edge a stored entrance photo is scaled down to, in pixels. */
const PHOTO_MAX_EDGE = 1400;
/** Refuse anything above this before we even try to read it. */
const PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Downscale a chosen image in the browser and hand back a data: URL.
 *
 * A photo straight off a phone is 3-5 MB, which is too big to sit in a settings
 * row and too big to attach to every confirmation email. Scaling to a long edge
 * of 1400px lands around 200-400 KB — plenty to recognise a front door by, and
 * small enough that the client's inbox doesn't mind.
 */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process that image"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like an image"));
    };
    img.src = url;
  });
}

/** Pick, preview and remove one clinic's entrance photo. */
function PhotoField({
  label,
  clinicLabel,
  value,
  onChange,
  onError,
}: {
  label: string;
  clinicLabel: string;
  value: string;
  onChange: (dataUrl: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > PHOTO_MAX_UPLOAD_BYTES) {
      onError("That photo is very large — please pick one under 15 MB");
      return;
    }
    setBusy(true);
    try {
      onChange(await shrinkImage(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't read that photo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">{label}</span>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={`The entrance at ${clinicLabel}`}
          className="max-h-[170px] w-fit rounded-lg border border-line object-cover"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-hoverbg">
          {busy ? "Reading…" : value ? "Replace photo" : "Choose a photo"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              // Let the same file be picked again after a remove.
              e.target.value = "";
            }}
          />
        </label>
        {value && (
          <button
            onClick={() => onChange("")}
            className="cursor-pointer text-[12px] font-semibold text-muted hover:text-[oklch(0.55_0.15_25)]"
          >
            Remove
          </button>
        )}
      </div>
      <span className="text-[11.5px] text-muted">
        Shown on the booking page and sent with the confirmation email, so they can see the door before they arrive.
      </span>
    </div>
  );
}
