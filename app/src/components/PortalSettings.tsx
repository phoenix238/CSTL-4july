"use client";

import { useState } from "react";
import { api, Card, inputClass, PrimaryButton, useToast } from "./ui";

export interface PortalSettingsData {
  portalEnabled: boolean;
  portalSelfBook: boolean;
  portalNotifyEmail: boolean;
  portalReceipts: boolean;
  portalNoticeHours: number;
  lateCancelGoodwillPence: number;
  bankAccountName: string;
  bankSortCode: string;
  bankAccountNumber: string;
  bankPaymentNote: string;
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="text-[11.5px] leading-[1.5] text-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Settings for the client portal — the private page each client gets, and the
 * bank details it shows them.
 */
export function PortalSettings({ initial }: { initial: PortalSettingsData }) {
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof PortalSettingsData>(key: K, value: PortalSettingsData[K]) => {
    setDraft((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  // Held as text while editing so the field can be emptied mid-type without
  // snapping back to 0 — parsed on save.
  const [goodwillText, setGoodwillText] = useState((initial.lateCancelGoodwillPence / 100).toString());

  async function save() {
    const pounds = Number(goodwillText);
    if (!Number.isFinite(pounds) || pounds < 0) {
      toast("The contribution needs to be a number of pounds, or 0 to turn it off");
      return;
    }
    setSaving(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ ...draft, lateCancelGoodwillPence: Math.round(pounds * 100) }),
      });
      toast("Client page settings saved ✓");
      setDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <div className="text-[13px] font-semibold text-ink">How it works</div>
        <p className="text-[12px] leading-[1.6] text-muted">
          Each client gets a private link of their own — no password, nothing to sign up for. Send it from their
          profile (&quot;Email page to …&quot;). From it they can book their next session, move it, cancel it, see
          which sessions they&apos;ve paid for, and find your bank details with their own reference already filled in.
          You&apos;re emailed every time they do anything.
        </p>
      </Card>

      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <div className="text-[13px] font-semibold text-ink">Your bank details</div>
        <p className="text-[12px] leading-[1.6] text-muted">
          Shown on every client&apos;s page alongside their own payment reference. Leave blank to hide the panel.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-soft">Account name</span>
          <input
            value={draft.bankAccountName}
            onChange={(e) => set("bankAccountName", e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-ink-soft">Sort code</span>
            <input
              value={draft.bankSortCode}
              onChange={(e) => set("bankSortCode", e.target.value)}
              placeholder="00-00-00"
              className={inputClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-ink-soft">Account number</span>
            <input
              value={draft.bankAccountNumber}
              onChange={(e) => set("bankAccountNumber", e.target.value)}
              placeholder="12345678"
              className={inputClass}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-soft">Anything else to say about paying</span>
          <textarea
            value={draft.bankPaymentNote}
            onChange={(e) => set("bankPaymentNote", e.target.value)}
            rows={2}
            placeholder="Cash is fine too — whatever's easiest."
            className={inputClass}
          />
        </label>
      </Card>

      <Card className="flex flex-col gap-3.5 px-4 py-3.5">
        <div className="text-[13px] font-semibold text-ink">Moving and cancelling</div>

        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium text-ink">
            Notice needed to move a session — {draft.portalNoticeHours} hours
          </span>
          <input
            type="range"
            min={0}
            max={72}
            step={6}
            value={draft.portalNoticeHours}
            onChange={(e) => set("portalNoticeHours", Number(e.target.value))}
            className="w-full cursor-pointer accent-[oklch(0.58_0.115_42)]"
          />
          <span className="text-[11.5px] leading-[1.5] text-muted">
            Closer than this and they&apos;re asked to message you instead. Cancelling is always allowed, whatever the
            notice — someone who can&apos;t come needs to be able to say so.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium text-ink">Suggested contribution for a late cancellation</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-muted">£</span>
            <input
              value={goodwillText}
              onChange={(e) => {
                setGoodwillText(e.target.value);
                setDirty(true);
              }}
              inputMode="decimal"
              className={`${inputClass} max-w-[90px]`}
            />
          </div>
          <span className="text-[11.5px] leading-[1.5] text-muted">
            Offered as a contribution towards the room, never charged and never counted as owing — the wording on
            their page makes that explicit. Set to 0 to stop mentioning it at all.
          </span>
        </label>
      </Card>

      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <Toggle
          label="Client pages are on"
          hint="Turn off to disable every client's link at once."
          checked={draft.portalEnabled}
          onChange={(v) => set("portalEnabled", v)}
        />
        <Toggle
          label="Clients can book their next session themselves"
          hint="Turn off and their page still shows their sessions, payments and reference — they just message you to book."
          checked={draft.portalSelfBook}
          onChange={(v) => set("portalSelfBook", v)}
        />
        <Toggle
          label="Email me whenever a client books, moves or cancels"
          hint="Your only signal that something changed — worth leaving on."
          checked={draft.portalNotifyEmail}
          onChange={(v) => set("portalNotifyEmail", v)}
        />
        <Toggle
          label="Clients can email themselves a receipt"
          hint="Lists the sessions you've marked as paid, and tells you it went out."
          checked={draft.portalReceipts}
          onChange={(v) => set("portalReceipts", v)}
        />
      </Card>

      <PrimaryButton onClick={save} disabled={!dirty || saving} className="self-start px-4 py-1.5 text-[12.5px]">
        {saving ? "Saving…" : "Save client page settings"}
      </PrimaryButton>
    </div>
  );
}
