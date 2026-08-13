"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, PrimaryButton, inputClass, useToast } from "./ui";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { composeBookingEmail, type EmailBlock, type EmailSettings } from "@/lib/booking/email";
import { checkEmail, type EmailIssue } from "@/lib/booking/emailChecks";
import {
  ClientMessagesEditor,
  SETTINGS_MESSAGE_DEFAULTS,
  type PreviewContext,
  type SettingsMessages,
} from "./ClientMessagesEditor";
import type { ClientCopy } from "@/lib/clientCopy";

// A specific, believable booking — not a real client, but not the PREVIEW_*
// stand-ins either. Those belong in the booking panel's live preview, where a
// client's tokens genuinely don't exist yet (see email.ts); here they'd just
// be one more thing on the canvas that looks like a bug.
const SAMPLE_NAME = "Maya";
const SAMPLE_WHEN = "Fri 14 Aug · 12:15";
const SAMPLE_LINKS = {
  intakeLink: "https://your-site/intake/ab12cd",
  portalLink: "https://your-site/me/ab12cd",
  paymentRef: "MAYA-4K2",
};

type Which = "first" | "returning";
type LocationField =
  | "waterlooAddress"
  | "bethnalAddress"
  | "waterlooLocationUrl"
  | "bethnalLocationUrl"
  | "waterlooFindIt"
  | "bethnalFindIt";
type LocationDraft = Record<LocationField, string>;

/** Which inline editor is open. "accessNote" isn't an EmailBlock of its own —
 * it's a substring inside "letter" — so it rides its own pseudo-id. */
type OpenId = EmailBlock["id"] | "accessNote" | null;

const tab = (active: boolean) =>
  `cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold ${
    active ? "bg-clay-text text-white" : "bg-[oklch(0.94_0.01_80)] text-muted hover:text-ink"
  }`;

/** The small floating label that names a region on hover — never blocks the click under it. */
function ChipLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute -top-2 left-2 hidden rounded-full bg-clay-text px-2 py-[2px] text-[10px] font-semibold whitespace-nowrap text-white group-hover:block">
      {children}
    </span>
  );
}

/** One clickable region of the composed email — hover to see what it is, click to edit it. */
function BlockRegion({
  label,
  editable,
  active,
  onClick,
  children,
}: {
  label: string;
  editable: boolean;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={editable ? onClick : undefined}
      className={`group relative -mx-2 rounded-lg px-2 py-1.5 whitespace-pre-line transition-colors ${
        editable ? "cursor-pointer hover:bg-[oklch(0.97_0.01_85)]" : ""
      } ${active ? "bg-[oklch(0.97_0.01_85)] outline outline-1 outline-clay/30" : ""}`}
    >
      <ChipLabel>{label}</ChipLabel>
      {children}
    </div>
  );
}

/** The letter, with the access note (if present) picked out as its own clickable substring. */
function LetterRegion({
  text,
  accessNote,
  isLetterOpen,
  isAccessOpen,
  onOpenLetter,
  onOpenAccessNote,
}: {
  text: string;
  accessNote: string;
  isLetterOpen: boolean;
  isAccessOpen: boolean;
  onOpenLetter: () => void;
  onOpenAccessNote: () => void;
}) {
  const trimmed = accessNote.trim();
  const idx = trimmed ? text.indexOf(trimmed) : -1;
  if (idx === -1) {
    return (
      <BlockRegion label="Your words" editable active={isLetterOpen} onClick={onOpenLetter}>
        {text}
      </BlockRegion>
    );
  }
  const before = text.slice(0, idx);
  const after = text.slice(idx + trimmed.length);
  return (
    <div
      className={`group relative -mx-2 rounded-lg px-2 py-1.5 whitespace-pre-line transition-colors hover:bg-[oklch(0.97_0.01_85)] ${
        isLetterOpen ? "bg-[oklch(0.97_0.01_85)] outline outline-1 outline-clay/30" : ""
      }`}
    >
      <ChipLabel>Your words</ChipLabel>
      <span onClick={onOpenLetter} className="cursor-pointer whitespace-pre-line">
        {before}
      </span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          onOpenAccessNote();
        }}
        title="Access note — click to edit"
        className={`cursor-pointer rounded px-0.5 whitespace-pre-line ${
          isAccessOpen ? "bg-clay-tint" : "bg-clay-tint/50 hover:bg-clay-tint"
        }`}
      >
        {trimmed}
      </span>
      <span onClick={onOpenLetter} className="cursor-pointer whitespace-pre-line">
        {after}
      </span>
    </div>
  );
}

function TextEditor({
  value,
  onChange,
  minHeight = 90,
  suggestion,
}: {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
  /** A recommended replacement, offered — never applied automatically. */
  suggestion?: string;
}) {
  const showSuggestion = !!suggestion && suggestion.trim() !== value.trim();
  return (
    <Card className="mt-1 flex flex-col gap-1.5 border-[1.5px] border-clay/35 p-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ minHeight }}
        className={`${inputClass} resize-y border-none bg-transparent leading-[1.55] focus:border-none`}
        autoFocus
      />
      {showSuggestion && (
        <button
          onClick={() => onChange(suggestion)}
          className="cursor-pointer self-start rounded-lg bg-[oklch(0.97_0.01_85)] px-2.5 py-1.5 text-left text-[12px] leading-[1.4] text-muted hover:bg-clay-tint/60"
        >
          <span className="font-semibold text-clay-text">Use recommended wording</span> — “{suggestion}”
        </button>
      )}
    </Card>
  );
}

function LocationEditor({
  clinic,
  draft,
  onChange,
}: {
  clinic: Clinic;
  draft: LocationDraft;
  onChange: (field: LocationField, value: string) => void;
}) {
  const addrKey: LocationField = clinic === "waterloo" ? "waterlooAddress" : "bethnalAddress";
  const urlKey: LocationField = clinic === "waterloo" ? "waterlooLocationUrl" : "bethnalLocationUrl";
  const findItKey: LocationField = clinic === "waterloo" ? "waterlooFindIt" : "bethnalFindIt";
  return (
    <Card className="mt-1 flex flex-col gap-2.5 border-[1.5px] border-clay/35 px-3.5 py-3">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">ADDRESS</span>
        <input value={draft[addrKey]} onChange={(e) => onChange(addrKey, e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">MAP PIN</span>
        <input value={draft[urlKey]} onChange={(e) => onChange(urlKey, e.target.value)} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">HOW TO FIND IT</span>
        <textarea
          value={draft[findItKey]}
          onChange={(e) => onChange(findItKey, e.target.value)}
          className={`${inputClass} min-h-[70px] resize-y leading-[1.55]`}
        />
      </label>
    </Card>
  );
}

function BankInfoPanel({ context }: { context: PreviewContext }) {
  return (
    <Card className="mt-1 flex flex-col gap-2 border-[1.5px] border-clay/35 px-3.5 py-3 text-[12.5px] leading-[1.5] text-muted">
      <div>
        These come from <span className="font-semibold text-ink-soft">Settings › Client pages</span>, not from here —
        the account name, sort code, account number and the note underneath are all set together there.
      </div>
      <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-2.5 py-2 text-[12px] text-[oklch(0.4_0.02_60)]">
        {context.bankAccountName || "not set"} · {context.bankSortCode || "not set"} · {context.bankAccountNumber || "not set"}
      </div>
    </Card>
  );
}

function IssuesPanel({ issues, onJump }: { issues: EmailIssue[]; onJump: (blockId?: EmailBlock["id"]) => void }) {
  if (!issues.length) {
    return (
      <div className="rounded-xl border border-sage/30 bg-sage-tint px-3.5 py-2.5 text-[12.5px] font-medium text-sage-text">
        No problems found in this version of the email.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {issues.map((issue, i) => (
        <button
          key={i}
          onClick={() => onJump(issue.blockId)}
          className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-[12.5px] leading-[1.45] ${
            issue.severity === "problem" ? "bg-amber-tint text-amber-text" : "bg-[oklch(0.96_0.01_85)] text-muted"
          }`}
        >
          <span className="font-semibold">{issue.message}</span>
          <span className="text-[11.5px] opacity-85">{issue.detail}</span>
        </button>
      ))}
    </div>
  );
}

export function MessageStudio({
  settingsInitial,
  previewContext,
}: {
  settingsInitial: SettingsMessages;
  previewContext: PreviewContext;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sDraft, setSDraft] = useState<SettingsMessages>(settingsInitial);
  const [locDraft, setLocDraft] = useState<LocationDraft>({
    waterlooAddress: previewContext.waterlooAddress,
    bethnalAddress: previewContext.bethnalAddress,
    waterlooLocationUrl: previewContext.waterlooLocationUrl,
    bethnalLocationUrl: previewContext.bethnalLocationUrl,
    waterlooFindIt: previewContext.waterlooFindIt,
    bethnalFindIt: previewContext.bethnalFindIt,
  });
  const [which, setWhich] = useState<Which>("first");
  const [clinic, setClinic] = useState<Clinic>("bethnal");
  const [openId, setOpenId] = useState<OpenId>(null);
  const [saving, setSaving] = useState(false);

  const S_KEYS = Object.keys(settingsInitial) as (keyof SettingsMessages)[];
  const L_KEYS = Object.keys(locDraft) as LocationField[];
  const settingsDirty = S_KEYS.some((k) => sDraft[k] !== settingsInitial[k]);
  const locationDirty = L_KEYS.some((k) => locDraft[k] !== previewContext[k]);
  const dirty = settingsDirty || locationDirty;

  const setSetting = (k: keyof SettingsMessages, v: string) => setSDraft((d) => ({ ...d, [k]: v }));
  const setLocation = (k: LocationField, v: string) => setLocDraft((d) => ({ ...d, [k]: v }));

  const previewSettings: EmailSettings = useMemo(
    () => ({
      emailTemplate: sDraft.emailTemplate,
      emailTemplateReturning: sDraft.emailTemplateReturning,
      emailSignOff: sDraft.emailSignOff,
      accessNote: sDraft.accessNote,
      paymentDetails: sDraft.paymentDetails,
      ...locDraft,
      bankAccountName: previewContext.bankAccountName,
      bankSortCode: previewContext.bankSortCode,
      bankAccountNumber: previewContext.bankAccountNumber,
      bankPaymentNote: previewContext.bankPaymentNote,
    }),
    [sDraft, locDraft, previewContext],
  );

  const composed = useMemo(
    () =>
      composeBookingEmail(
        { name: SAMPLE_NAME, welcomeSent: which === "returning" },
        clinic,
        SAMPLE_WHEN,
        true,
        previewSettings,
        SAMPLE_LINKS,
      ),
    [previewSettings, which, clinic],
  );

  const issues = useMemo(() => checkEmail(composed.blocks, previewSettings), [composed, previewSettings]);

  function jumpTo(blockId?: EmailBlock["id"]) {
    if (!blockId) return;
    setOpenId((current) => (current === blockId ? current : blockId));
  }

  async function saveAll() {
    setSaving(true);
    try {
      const settingsChanged: Partial<SettingsMessages> = {};
      for (const k of S_KEYS) {
        if (sDraft[k] !== settingsInitial[k]) settingsChanged[k] = sDraft[k];
      }
      const locationChanged: Partial<LocationDraft> = {};
      for (const k of L_KEYS) {
        if (locDraft[k] !== previewContext[k]) locationChanged[k] = locDraft[k];
      }
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ ...settingsChanged, ...locationChanged }),
      });
      toast("Saved ✓");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const clinicLabel = CLINIC_LABEL[clinic];

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2.5 px-4 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-muted">
          This is the exact email a client gets — not a form that hopes it reads right. Hover any part of it to see
          where it comes from; click to edit it right here.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5">
          <div className="flex gap-1.5">
            <button className={tab(which === "first")} onClick={() => setWhich("first")}>
              First time
            </button>
            <button className={tab(which === "returning")} onClick={() => setWhich("returning")}>
              Returning
            </button>
          </div>
          <div className="flex gap-1.5">
            {(["bethnal", "waterloo"] as Clinic[]).map((c) => (
              <button key={c} className={tab(clinic === c)} onClick={() => setClinic(c)}>
                {CLINIC_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-1 px-4 py-4">
        <div className="border-b border-line pb-2 text-[13px] font-semibold text-ink">{composed.subject}</div>
        <div className="pt-2 text-[13px] text-[oklch(0.4_0.02_60)]">
          {composed.blocks
            // Editable regions stay clickable even with nothing in them yet —
            // an empty "where" block is exactly the case that needs a click
            // target most: nothing set means nothing shows in the sent email,
            // but Phoenix still needs somewhere to click to add it. Only the
            // automatic, non-editable regions (portal/intake) are dropped
            // when empty, same as the real send.
            .filter((b) => b.text.trim() || b.id === "letter" || b.id === "where" || b.id === "payment" || b.id === "bank")
            .map((block) => {
              if (block.id === "letter") {
                return (
                  <LetterRegion
                    key="letter"
                    text={block.text}
                    accessNote={sDraft.accessNote}
                    isLetterOpen={openId === "letter"}
                    isAccessOpen={openId === "accessNote"}
                    onOpenLetter={() => setOpenId(openId === "letter" ? null : "letter")}
                    onOpenAccessNote={() => setOpenId(openId === "accessNote" ? null : "accessNote")}
                  />
                );
              }
              const editableField =
                block.id === "payment" ? "paymentDetails" : block.id === "signoff" ? "emailSignOff" : undefined;
              const placeholder =
                block.id === "where"
                  ? `Not set yet — click to add the address, map pin and how to find ${clinicLabel}.`
                  : block.id === "payment"
                    ? "Nothing set — click to add payment wording."
                    : block.id === "bank"
                      ? "No bank details set — click for where to add them."
                      : "";
              return (
                <div key={block.id}>
                  <BlockRegion
                    label={block.id === "where" ? `Where it is — ${clinicLabel}` : block.label}
                    editable={block.id === "where" || block.id === "bank" || !!editableField}
                    active={openId === block.id}
                    onClick={() => setOpenId(openId === block.id ? null : block.id)}
                  >
                    {block.text.trim() ? (
                      block.text
                    ) : (
                      <span className="text-faint italic">{placeholder}</span>
                    )}
                  </BlockRegion>
                  {openId === block.id && block.id === "where" && (
                    <LocationEditor clinic={clinic} draft={locDraft} onChange={setLocation} />
                  )}
                  {openId === block.id && block.id === "bank" && <BankInfoPanel context={previewContext} />}
                  {openId === block.id && editableField && (
                    <TextEditor
                      value={sDraft[editableField]}
                      onChange={(v) => setSetting(editableField, v)}
                      minHeight={editableField === "emailSignOff" ? 60 : 90}
                    />
                  )}
                </div>
              );
            })}
          {openId === "letter" && (
            <TextEditor
              value={which === "first" ? sDraft.emailTemplate : sDraft.emailTemplateReturning}
              onChange={(v) => setSetting(which === "first" ? "emailTemplate" : "emailTemplateReturning", v)}
            />
          )}
          {openId === "accessNote" && (
            <TextEditor
              value={sDraft.accessNote}
              onChange={(v) => setSetting("accessNote", v)}
              minHeight={70}
              suggestion={SETTINGS_MESSAGE_DEFAULTS.accessNote}
            />
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-1.5">
        <p className="px-1 text-[10.5px] font-semibold tracking-[0.09em] text-faint uppercase">Checks</p>
        <IssuesPanel issues={issues} onJump={jumpTo} />
      </div>

      {dirty && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-full border border-line bg-card px-3 py-2 shadow-card">
          <PrimaryButton onClick={saveAll} disabled={saving} className="px-4 py-1.5 text-[12.5px]">
            {saving ? "Saving…" : "Save changes"}
          </PrimaryButton>
          <button
            onClick={() => {
              setSDraft(settingsInitial);
              setLocDraft({
                waterlooAddress: previewContext.waterlooAddress,
                bethnalAddress: previewContext.bethnalAddress,
                waterlooLocationUrl: previewContext.waterlooLocationUrl,
                bethnalLocationUrl: previewContext.bethnalLocationUrl,
                waterlooFindIt: previewContext.waterlooFindIt,
                bethnalFindIt: previewContext.bethnalFindIt,
              });
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

/**
 * The default content of "ALL CLIENT MESSAGES" — the canvas first, with the
 * old field-by-field list one click away for the messages the canvas doesn't
 * cover (offer, intake resend, review, page wording).
 */
export function ClientMessagesPanel(props: {
  initial: ClientCopy;
  settingsInitial: SettingsMessages;
  previewContext: PreviewContext;
}) {
  const [mode, setMode] = useState<"studio" | "everything">("studio");
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex justify-end">
        <button
          onClick={() => setMode(mode === "studio" ? "everything" : "studio")}
          className="cursor-pointer text-[11.5px] font-semibold text-clay-text underline hover:text-clay"
        >
          {mode === "studio" ? "Edit every field instead" : "Back to the canvas"}
        </button>
      </div>
      {mode === "studio" ? (
        <MessageStudio settingsInitial={props.settingsInitial} previewContext={props.previewContext} />
      ) : (
        <ClientMessagesEditor {...props} />
      )}
    </div>
  );
}
