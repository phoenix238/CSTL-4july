"use client";

import { useMemo, useState } from "react";
import { api, Card, SectionLabel, PrimaryButton, useToast } from "./ui";
import { CASE_HISTORY_SECTIONS, entryKey, sectionHeading } from "@/lib/caseHistoryLayout";

/**
 * Take and add to a client's case history from inside the app — the same sheet
 * that's in their Doc, editable here so it doesn't have to be written in Drive.
 *
 * Saving writes the record and re-renders the Doc from it. What comes back from
 * the intake form arrives already filled in, tagged with where it came from.
 */
export function CaseHistoryPanel({
  clientId,
  entries: saved,
}: {
  clientId: string;
  entries: Record<string, string>;
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<Record<string, string>>(saved);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const value = (key: string) => entries[key] ?? "";
  const set = (key: string, v: string) => setEntries((prev) => ({ ...prev, [key]: v }));

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(saved), ...Object.keys(entries)]);
    return [...keys].some((k) => (saved[k] ?? "").trim() !== (entries[k] ?? "").trim());
  }, [saved, entries]);

  const filled = useMemo(
    () => Object.values(entries).filter((v) => v.trim()).length,
    [entries],
  );

  const save = async () => {
    setSaving(true);
    try {
      const res = await api<{ entries: Record<string, string>; docError: string }>(
        `/api/clients/${clientId}/case-history`,
        { method: "PUT", body: JSON.stringify({ entries }) },
      );
      setEntries(res.entries);
      toast(
        res.docError
          ? `Saved — but the Doc didn't update (${res.docError})`
          : "Case history saved ✓ — their Doc is updated",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const box = (key: string, label: string | null, placeholder: string, rows: "short" | "tall") => (
    <label key={key} className="flex flex-col gap-1">
      {label && <span className="text-[11.5px] font-semibold text-ink-soft">{label}</span>}
      <textarea
        value={value(key)}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className={`${rows === "tall" ? "min-h-[76px]" : "min-h-[52px]"} w-full resize-y rounded-lg border border-inputline bg-inputbg px-3 py-2 text-[13px] leading-[1.55] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]`}
      />
    </label>
  );

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionLabel>CASE HISTORY</SectionLabel>
          <div className="mt-1 text-[12px] text-muted">
            {filled ? `${filled} of the sheet filled in` : "Nothing recorded yet"}
            {dirty ? " · unsaved changes" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {open && dirty && (
            <PrimaryButton onClick={save} disabled={saving} className="px-4 py-1.5 text-[12.5px]">
              {saving ? "Saving…" : "Save"}
            </PrimaryButton>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
          >
            {open ? "Close" : filled ? "Open & add to it" : "Start taking it"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-4">
          {CASE_HISTORY_SECTIONS.map((section) => (
            <div key={section.key} className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-clay-text">
                {sectionHeading(section.key)}
              </div>
              {section.fields ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {section.fields.map((field) =>
                    box(entryKey(section.key, field.key), field.label, "", "short"),
                  )}
                </div>
              ) : (
                box(entryKey(section.key), null, section.hint, "tall")
              )}
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-[11.5px] leading-[1.5] text-muted">
              Saving rewrites their Doc from this. Anything already in the Doc that isn&apos;t part of
              the sheet is kept at the bottom under <em>Original record</em>.
            </span>
            <PrimaryButton onClick={save} disabled={saving || !dirty} className="shrink-0 px-5 py-2 text-[13px]">
              {saving ? "Saving…" : dirty ? "Save case history" : "Saved"}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Card>
  );
}
