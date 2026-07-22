"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Card, inputClass, PrimaryButton, SectionLabel, useToast } from "./ui";
import { IntakeQuestionsEditor } from "./IntakeQuestionsEditor";
import { AvailabilitySettings, type AvailabilityOverrideDTO } from "./AvailabilitySettings";
import { reconnectGoogle } from "@/lib/googleActions";
import type { IntakeQuestion } from "@/lib/intakeQuestions";
import type { WeeklyHours } from "@/lib/booking/availability";

export interface SettingsData {
  accessNote: string;
  emailTemplateWaterloo: string;
  emailTemplateBethnal: string;
  paymentDetails: string;
  waterlooAddress: string;
  bethnalAddress: string;
  waterlooArrivalNote: string;
  bethnalArrivalNote: string;
  appUrl: string;
  personalCalendarId: string;
  roomCalendarId: string;
  chalkFarmCalendarId: string;
  googleConnected: boolean;
  intakeQuestions: IntakeQuestion[];
  mapsReviewUrlWaterloo: string;
  mapsReviewUrlBethnal: string;
  reviewEmailSubjectWaterloo: string;
  reviewEmailSubjectBethnal: string;
  reviewEmailBodyWaterloo: string;
  reviewEmailBodyBethnal: string;
  weeklyHours: WeeklyHours;
  bookingSlotMinutes: number;
  bookingMinNoticeMins: number;
  bookingHorizonDays: number;
  bookingBufferMinutes: number;
  chalkFarmBufferMinutes: number;
  bookingNotifyEmail: boolean;
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

export function SettingsView({ settings, overrides }: { settings: SettingsData; overrides: AvailabilityOverrideDTO[] }) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingPayment, setEditingPayment] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState("");
  const [editingAddresses, setEditingAddresses] = useState(false);
  const [addressesDraft, setAddressesDraft] = useState({
    waterlooAddress: settings.waterlooAddress,
    bethnalAddress: settings.bethnalAddress,
    waterlooArrivalNote: settings.waterlooArrivalNote,
    bethnalArrivalNote: settings.bethnalArrivalNote,
  });
  const [emailClinic, setEmailClinic] = useState<"waterloo" | "bethnal">("bethnal");
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState("");
  const [reviewClinic, setReviewClinic] = useState<"waterloo" | "bethnal">("bethnal");
  const [editingReview, setEditingReview] = useState(false);
  const [reviewDraft, setReviewDraft] = useState({
    mapsReviewUrl: settings.mapsReviewUrlWaterloo,
    reviewEmailSubject: settings.reviewEmailSubjectWaterloo,
    reviewEmailBody: settings.reviewEmailBodyWaterloo,
  });
  const [editingGoogle, setEditingGoogle] = useState(false);
  const [googleDraft, setGoogleDraft] = useState({
    personalCalendarId: settings.personalCalendarId,
    roomCalendarId: settings.roomCalendarId,
    chalkFarmCalendarId: settings.chalkFarmCalendarId,
    appUrl: settings.appUrl,
  });

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

  const template = emailClinic === "waterloo" ? settings.emailTemplateWaterloo : settings.emailTemplateBethnal;

  const reviewFields =
    reviewClinic === "waterloo"
      ? {
          mapsReviewUrl: settings.mapsReviewUrlWaterloo,
          reviewEmailSubject: settings.reviewEmailSubjectWaterloo,
          reviewEmailBody: settings.reviewEmailBodyWaterloo,
        }
      : {
          mapsReviewUrl: settings.mapsReviewUrlBethnal,
          reviewEmailSubject: settings.reviewEmailSubjectBethnal,
          reviewEmailBody: settings.reviewEmailBodyBethnal,
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
            day&apos;s sessions, so clients can be booked close together.
          </div>
        </div>
        <div className="py-[15px]">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-base font-medium">Waterloo</span>
            <span className="text-xs font-semibold text-clay-text">£80 · 60 min</span>
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-[oklch(0.5_0.02_58)]">
            Creates two 1-hour events: &quot;(Client) — Waterloo&quot; on your personal calendar + &quot;R5 -
            Phoenix&quot; on the room calendar.
          </div>
        </div>
      </Card>

      <Dropdown label="CLINIC ADDRESSES & ARRIVAL NOTES" open={!!open.addresses} onToggle={() => toggle("addresses")}>
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => {
              if (!editingAddresses) {
                setAddressesDraft({
                  waterlooAddress: settings.waterlooAddress,
                  bethnalAddress: settings.bethnalAddress,
                  waterlooArrivalNote: settings.waterlooArrivalNote,
                  bethnalArrivalNote: settings.bethnalArrivalNote,
                });
              }
              setEditingAddresses(!editingAddresses);
            }}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingAddresses ? "Cancel" : "Edit"}
          </button>
        </div>
        {!editingAddresses ? (
          <Card className="px-5 py-1.5">
            <Row label="Waterloo">{settings.waterlooAddress || "not set yet"}</Row>
            <Row label="Waterloo note">{settings.waterlooArrivalNote || "not set yet"}</Row>
            <Row label="Bethnal Green">{settings.bethnalAddress || "not set yet"}</Row>
            <Row label="Bethnal Green note" last>
              {settings.bethnalArrivalNote || "not set yet"}
            </Row>
          </Card>
        ) : (
          <Card className="flex flex-col gap-[14px] border-[1.5px] border-clay/35 px-4 py-3.5">
            {(
              [
                ["waterlooAddress", "WATERLOO ADDRESS", "waterlooArrivalNote", "ABOUT WATERLOO"],
                ["bethnalAddress", "BETHNAL GREEN ADDRESS", "bethnalArrivalNote", "ABOUT BETHNAL GREEN"],
              ] as const
            ).map(([addrKey, addrLabel, noteKey, noteLabel]) => (
              <div key={addrKey} className="flex flex-col gap-[11px]">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    {addrLabel}
                  </span>
                  <input
                    value={addressesDraft[addrKey]}
                    onChange={(e) => setAddressesDraft({ ...addressesDraft, [addrKey]: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    {noteLabel}
                  </span>
                  <textarea
                    value={addressesDraft[noteKey]}
                    onChange={(e) => setAddressesDraft({ ...addressesDraft, [noteKey]: e.target.value })}
                    placeholder="Parking, what to expect, how to find the door — shown to visitors on the booking page."
                    className="min-h-[70px] w-full resize-y rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
                  />
                </label>
              </div>
            ))}
            <PrimaryButton
              onClick={() => save({ ...addressesDraft }, () => setEditingAddresses(false), "Clinic addresses updated ✓")}
              className="self-start px-[18px] py-[9px] text-[13px]"
            >
              Save
            </PrimaryButton>
          </Card>
        )}
        <div className="text-[11.5px] text-muted">
          Addresses are used as the location on the calendar invite (Google adds a map link automatically) and for
          the Google Maps link in a new client&apos;s welcome email and on the booking page. The note for each clinic
          shows under its address on the public booking page — useful for parking, buzzer codes, or what to expect.
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
          chalkFarmBufferMinutes={settings.chalkFarmBufferMinutes}
          bookingNotifyEmail={settings.bookingNotifyEmail}
          baseUrl={baseUrl}
        />
      </Dropdown>

      {/* ───────────────── 3 · The emails clients receive ───────────────── */}
      <Stage
        n={3}
        title="The emails clients receive"
        blurb="Every message that goes out, in order: a warm welcome when they first book, their intake form as its own separate step, then a gentle review request after the session."
      />

      <Dropdown
        label="WELCOME EMAIL — A NEW CLIENT'S FIRST EMAIL, BY LOCATION"
        open={!!open.emailTemplate}
        onToggle={() => toggle("emailTemplate")}
      >
        <Card className="flex flex-col gap-3 px-[18px] py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
              {(["bethnal", "waterloo"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setEmailClinic(c);
                    setEditingTemplate(false);
                  }}
                  className={`cursor-pointer rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
                    emailClinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                  }`}
                >
                  {c === "waterloo" ? "Waterloo" : "Bethnal Green"}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                if (!editingTemplate) setTemplateDraft(template);
                setEditingTemplate(!editingTemplate);
              }}
              className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
            >
              {editingTemplate ? "Cancel" : "Edit"}
            </button>
          </div>
          {!editingTemplate ? (
            <div className="rounded-[10px] bg-inputbg px-3.5 py-3 text-[13px] leading-[1.6] whitespace-pre-wrap text-[oklch(0.35_0.02_60)]">
              {template}
            </div>
          ) : (
            <>
              <textarea
                value={templateDraft}
                onChange={(e) => setTemplateDraft(e.target.value)}
                className="min-h-[170px] w-full resize-y rounded-[10px] border border-line bg-inputbg px-3.5 py-3 text-[13px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
              />
              <PrimaryButton
                onClick={() =>
                  save(
                    emailClinic === "waterloo"
                      ? { emailTemplateWaterloo: templateDraft }
                      : { emailTemplateBethnal: templateDraft },
                    () => setEditingTemplate(false),
                    "Email template updated ✓",
                  )
                }
                className="self-start px-[18px] py-[9px] text-[13px]"
              >
                Save
              </PrimaryButton>
            </>
          )}
          <div className="text-[11.5px] leading-[1.6] text-muted">
            This is the first email a new client gets — use {"{name}"} for their name and {"{accessNote}"} for the
            access note below. It goes out when you confirm their booking; returning clients just get the calendar
            invite. The intake form is <b>no longer attached here</b> — it&apos;s sent as its own step after booking,
            so if your saved template still says &quot;the intake form link is below&quot;, you can remove that line.
          </div>
        </Card>
      </Dropdown>

      <Dropdown
        label="· ACCESS NOTE — INCLUDED IN THE WELCOME EMAIL"
        open={!!open.accessNote}
        onToggle={() => toggle("accessNote")}
      >
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => {
              if (!editingNote) setNoteDraft(settings.accessNote);
              setEditingNote(!editingNote);
            }}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingNote ? "Cancel" : "Edit"}
          </button>
        </div>
        {!editingNote ? (
          <div className="rounded-2xl border border-[oklch(0.87_0.05_48_/_0.5)] bg-[oklch(0.94_0.03_48_/_0.5)] px-[18px] py-3.5 text-[13px] leading-[1.6] text-[oklch(0.4_0.06_48)]">
            &quot;{settings.accessNote}&quot;
          </div>
        ) : (
          <Card className="flex flex-col gap-2.5 border-[1.5px] border-clay/35 px-4 py-3.5">
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              className="min-h-[100px] w-full resize-y rounded-[10px] border border-line bg-inputbg px-3 py-2.5 text-[13px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
            />
            <PrimaryButton
              onClick={() => save({ accessNote: noteDraft }, () => setEditingNote(false), "Access note updated ✓")}
              className="self-start px-[18px] py-[9px] text-[13px]"
            >
              Save
            </PrimaryButton>
          </Card>
        )}
        <div className="text-[11.5px] text-muted">
          Slots into the welcome email wherever you put {"{accessNote}"} in the template above.
        </div>
      </Dropdown>

      <Dropdown
        label="· PAYMENT / BANK DETAILS — INCLUDED IN THE WELCOME EMAIL"
        open={!!open.payment}
        onToggle={() => toggle("payment")}
      >
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => {
              if (!editingPayment) setPaymentDraft(settings.paymentDetails);
              setEditingPayment(!editingPayment);
            }}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingPayment ? "Cancel" : "Edit"}
          </button>
        </div>
        {!editingPayment ? (
          <div className="rounded-2xl border border-[oklch(0.87_0.05_48_/_0.5)] bg-[oklch(0.94_0.03_48_/_0.5)] px-[18px] py-3.5 text-[13px] leading-[1.6] whitespace-pre-wrap text-[oklch(0.4_0.06_48)]">
            {settings.paymentDetails}
          </div>
        ) : (
          <Card className="flex flex-col gap-2.5 border-[1.5px] border-clay/35 px-4 py-3.5">
            <textarea
              value={paymentDraft}
              onChange={(e) => setPaymentDraft(e.target.value)}
              className="min-h-[100px] w-full resize-y rounded-[10px] border border-line bg-inputbg px-3 py-2.5 text-[13px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
            />
            <PrimaryButton
              onClick={() => save({ paymentDetails: paymentDraft }, () => setEditingPayment(false), "Payment details updated ✓")}
              className="self-start px-[18px] py-[9px] text-[13px]"
            >
              Save
            </PrimaryButton>
          </Card>
        )}
        <div className="text-[11.5px] text-muted">
          Your real bank details — inserted when you tick &quot;include payment details&quot; while confirming a new
          client&apos;s session.
        </div>
      </Dropdown>

      <Dropdown
        label="INTAKE FORM — SENT ON ITS OWN, AFTER BOOKING"
        open={!!open.intakeQuestions}
        onToggle={() => toggle("intakeQuestions")}
      >
        <div className="rounded-xl border border-line bg-inputbg px-4 py-3 text-[12.5px] leading-[1.6] text-muted">
          The intake form is kept out of the welcome email on purpose, so a client&apos;s first message stays a warm
          hello. You send it as its own step — the &quot;Send intake form&quot; button appears right after you book
          someone, and on every client&apos;s profile. These are the questions it asks:
        </div>
        <IntakeQuestionsEditor initial={settings.intakeQuestions} />
      </Dropdown>

      <Dropdown label="POST-SESSION REVIEW EMAIL" open={!!open.reviewEmail} onToggle={() => toggle("reviewEmail")}>
        <Card className="flex flex-col gap-3 px-[18px] py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
              {(["bethnal", "waterloo"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setReviewClinic(c);
                    setEditingReview(false);
                  }}
                  className={`cursor-pointer rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
                    reviewClinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                  }`}
                >
                  {c === "waterloo" ? "Waterloo" : "Bethnal Green"}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                if (!editingReview) setReviewDraft(reviewFields);
                setEditingReview(!editingReview);
              }}
              className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
            >
              {editingReview ? "Cancel" : "Edit"}
            </button>
          </div>
          {!editingReview ? (
            <>
              <Row label="Google review link">{reviewFields.mapsReviewUrl || "not set yet"}</Row>
              <Row label="Subject">{reviewFields.reviewEmailSubject}</Row>
              <Row label="Body" last>
                <span className="whitespace-pre-wrap">{reviewFields.reviewEmailBody}</span>
              </Row>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                  GOOGLE REVIEW LINK — {reviewClinic === "waterloo" ? "WATERLOO" : "BETHNAL GREEN"}
                </span>
                <input
                  value={reviewDraft.mapsReviewUrl}
                  onChange={(e) => setReviewDraft({ ...reviewDraft, mapsReviewUrl: e.target.value })}
                  placeholder="https://g.page/r/…/review"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">SUBJECT</span>
                <input
                  value={reviewDraft.reviewEmailSubject}
                  onChange={(e) => setReviewDraft({ ...reviewDraft, reviewEmailSubject: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">BODY</span>
                <textarea
                  value={reviewDraft.reviewEmailBody}
                  onChange={(e) => setReviewDraft({ ...reviewDraft, reviewEmailBody: e.target.value })}
                  className="min-h-[180px] w-full resize-y rounded-[10px] border border-line bg-inputbg px-3.5 py-3 text-[13px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
                />
              </label>
              <PrimaryButton
                onClick={() =>
                  save(
                    reviewClinic === "waterloo"
                      ? {
                          mapsReviewUrlWaterloo: reviewDraft.mapsReviewUrl,
                          reviewEmailSubjectWaterloo: reviewDraft.reviewEmailSubject,
                          reviewEmailBodyWaterloo: reviewDraft.reviewEmailBody,
                        }
                      : {
                          mapsReviewUrlBethnal: reviewDraft.mapsReviewUrl,
                          reviewEmailSubjectBethnal: reviewDraft.reviewEmailSubject,
                          reviewEmailBodyBethnal: reviewDraft.reviewEmailBody,
                        },
                    () => setEditingReview(false),
                    "Review email updated ✓",
                  )
                }
                className="self-start px-[18px] py-[9px] text-[13px]"
              >
                Save
              </PrimaryButton>
            </>
          )}
          <div className="text-[11.5px] text-muted">
            Each clinic has its own Google review link and email — use {"{name}"} for their first name, {"{mapsUrl}"}{" "}
            for that clinic&apos;s review link, and {"{optInLink}"} for the one-tap marketing opt-in link. Send it
            from a client&apos;s profile after their first session; the clinic on their record picks which one goes
            out.
          </div>
        </Card>
      </Dropdown>

      {/* ───────────────── 4 · Behind the scenes ───────────────── */}
      <Stage
        n={4}
        title="Behind the scenes"
        blurb="How the app connects to your Google account to create calendar events, save notes to Drive, and send email as you."
      />

      <Dropdown label="GOOGLE — CALENDAR, DRIVE & GMAIL" open={!!open.google} onToggle={() => toggle("google")}>
        <div className="flex items-center justify-end px-0.5">
          <button
            onClick={() => setEditingGoogle(!editingGoogle)}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {editingGoogle ? "Cancel" : "Edit"}
          </button>
        </div>
        <form action={reconnectGoogle} className="px-0.5 pb-1.5">
          <button
            type="submit"
            className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-clay-text hover:bg-hoverbg"
          >
            Reconnect Google
          </button>
          <p className="mt-1.5 text-[11px] leading-[1.5] text-muted">
            Use this if sending an email fails with a permissions error — it refreshes Google&apos;s
            connection with the latest access (Calendar, Drive, Gmail, Sheets).
          </p>
        </form>
        {!editingGoogle ? (
          <Card className="px-5 py-1.5">
            <Row label="Connection">
              <span className={settings.googleConnected ? "text-sage-text" : "text-amber-text"}>
                {settings.googleConnected ? "✓ Connected — Drive · Calendar · Gmail · Sheets" : "Not connected — sign out and back in with Google"}
              </span>
            </Row>
            <Row label="Client folders & Docs">Drive › CSTL › Clients › (client name)</Row>
            <Row label="Marketing spreadsheet">Drive › CSTL › Clients › Docs</Row>
            <Row label="Intake form">In-app form — {baseUrl}/intake/…</Row>
            <Row label="Personal calendar">{settings.personalCalendarId || "primary"}</Row>
            <Row label="R5 room calendar">{settings.roomCalendarId || "not set — needed for Waterloo bookings"}</Row>
            <Row label="Chalk Farm calendar">
              {settings.chalkFarmCalendarId || "not set — needed for Bethnal Green bookings"}
            </Row>
            <Row label="Event reminders" last>
              Email 24 h before · popup 1 h before
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
      </Dropdown>

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
