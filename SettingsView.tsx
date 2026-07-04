"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Card, inputClass, PrimaryButton, SectionLabel, useToast } from "./ui";

export interface SettingsData {
  accessNote: string;
  emailTemplateWaterloo: string;
  emailTemplateBethnal: string;
  paymentDetails: string;
  intakeFormUrl: string;
  personalCalendarId: string;
  roomCalendarId: string;
  chalkFarmCalendarId: string;
  googleConnected: boolean;
}

export function SettingsView({ settings }: { settings: SettingsData }) {
  const router = useRouter();
  const toast = useToast();

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [emailClinic, setEmailClinic] = useState<"waterloo" | "bethnal">("waterloo");
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState("");
  const [editingGoogle, setEditingGoogle] = useState(false);
  const [googleDraft, setGoogleDraft] = useState({
    personalCalendarId: settings.personalCalendarId,
    roomCalendarId: settings.roomCalendarId,
    chalkFarmCalendarId: settings.chalkFarmCalendarId,
    intakeFormUrl: settings.intakeFormUrl,
    paymentDetails: settings.paymentDetails,
  });

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

  return (
    <div className="flex max-w-[760px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Settings</h1>

      <SectionLabel>CLINICS &amp; BOOKING RULES</SectionLabel>
      <Card className="px-5 py-1.5">
        <div className="border-b border-hairline py-[15px]">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-base font-medium">Waterloo</span>
            <span className="text-xs font-semibold text-clay-text">£80 · 60 min</span>
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-[oklch(0.5_0.02_58)]">
            Creates two 1-hour events: &quot;(Client) — Waterloo&quot; on your personal calendar + &quot;R5 -
            Phoenix&quot; on the room calendar.
          </div>
        </div>
        <div className="py-[15px]">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-base font-medium">Bethnal Green</span>
            <span className="text-xs font-semibold text-sage-text">£30–60 sliding · 60 min</span>
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.6] text-[oklch(0.5_0.02_58)]">
            Creates a 2-hour &quot;Phoenix&quot; block on the Chalk Farm calendar with the 1-hour &quot;(Client) —
            Bethnal Green&quot; personal event in the middle.
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between px-0.5 pt-2">
        <SectionLabel>ACCESS NOTE — GOES IN A NEW CLIENT&apos;S FIRST EMAIL</SectionLabel>
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

      <SectionLabel className="pt-2">NEW CLIENT EMAIL — BY LOCATION</SectionLabel>
      <Card className="flex flex-col gap-3 px-[18px] py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
            {(["waterloo", "bethnal"] as const).map((c) => (
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
        <div className="text-[11.5px] text-muted">
          This is the first email a new client gets — use {"{name}"} for their name and {"{accessNote}"} for the
          access note above. It shows up when you confirm a booking for that location. Returning clients just get
          the calendar invite.
        </div>
      </Card>

      <div className="flex items-center justify-between px-0.5 pt-2">
        <SectionLabel>GOOGLE</SectionLabel>
        <button
          onClick={() => setEditingGoogle(!editingGoogle)}
          className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
        >
          {editingGoogle ? "Cancel" : "Edit"}
        </button>
      </div>
      {!editingGoogle ? (
        <Card className="px-5 py-1.5">
          <Row label="Connection">
            <span className={settings.googleConnected ? "text-sage-text" : "text-amber-text"}>
              {settings.googleConnected ? "✓ Connected — Drive · Calendar · Gmail · Sheets" : "Not connected — sign out and back in with Google"}
            </span>
          </Row>
          <Row label="Client folders & Docs">Drive › CSTL › Clients › (client name)</Row>
          <Row label="Marketing spreadsheet">Drive › CSTL › Clients › Docs</Row>
          <Row label="Intake form">{settings.intakeFormUrl}</Row>
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
              ["intakeFormUrl", "INTAKE FORM LINK", "the Google Form new clients fill in"],
              ["paymentDetails", "PAYMENT DETAILS", "bank details / payment text for new-client emails"],
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
