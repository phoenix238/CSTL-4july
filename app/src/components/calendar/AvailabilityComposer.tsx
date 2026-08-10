"use client";

import { useState } from "react";
import { fmtDayLong, londonDateKey } from "@/lib/time";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, TintButton, inputClass, useEscapeKey, useToast } from "../ui";
import type { AvailClinic } from "./layout";

const CLINIC_LABEL: Record<AvailClinic, string> = {
  bethnal: "Bethnal Green",
  waterloo: "Waterloo",
};

const minToTime = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Set or edit one date-specific availability window drawn on the calendar —
 * the practitioner-facing counterpart to the recurring weekly hours in Settings.
 * Saving writes an AvailabilityOverride, which the public booking page reads
 * directly: an "Available" window opens extra bookable time, "Unavailable"
 * closes it.
 */
export function AvailabilityComposer({
  mode,
  clinic,
  day,
  startMin,
  endMin,
  kind: initialKind = "open",
  repeatWeekly: initialRepeat = false,
  exactStart: initialExact = false,
  id,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  clinic: AvailClinic;
  day: Date;
  startMin: number;
  endMin: number;
  kind?: "open" | "block";
  repeatWeekly?: boolean;
  exactStart?: boolean;
  id?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  useEscapeKey(onClose);
  const [kind, setKind] = useState<"open" | "block">(initialKind);
  const [startTime, setStartTime] = useState(minToTime(startMin));
  const [endTime, setEndTime] = useState(minToTime(endMin));
  const [repeatWeekly, setRepeatWeekly] = useState(initialRepeat);
  // "block" = an open stretch the booking grid fills with start times.
  // "slot"  = one exact pickable start time (exactStart on the override).
  const [fill, setFill] = useState<"block" | "slot">(initialExact ? "slot" : "block");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const weekdayName = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(day);

  async function save() {
    const s = timeToMin(startTime);
    const e = timeToMin(endTime);
    if (e <= s) {
      toast("End time must be after the start");
      return;
    }
    setSaving(true);
    try {
      // A single slot only makes sense for open time; a block is always a stretch.
      const exactStart = kind === "open" && fill === "slot";
      if (mode === "create") {
        await api("/api/availability-overrides", {
          method: "POST",
          body: JSON.stringify({ clinic, date: londonDateKey(day), kind, startMin: s, endMin: e, note: "", repeatWeekly, exactStart }),
        });
      } else {
        await api(`/api/availability-overrides/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ kind, startMin: s, endMin: e, repeatWeekly, exactStart }),
        });
      }
      toast(kind === "open" ? "Availability saved ✓" : "Marked unavailable ✓");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that");
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    // A repeating window is a series — deleting the row clears every future week,
    // so say so plainly rather than have a whole recurring day vanish on one tap.
    if (initialRepeat && !window.confirm(`Remove this repeating ${weekdayName} time from every week? To close just this one day, mark it Unavailable instead.`)) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/api/availability-overrides/${id}`, { method: "DELETE" });
      toast(initialRepeat ? "Repeating time removed" : "Removed");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove that");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[oklch(0.3_0.02_60_/_0.18)]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2"
      >
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <div className="font-serif text-[19px] font-medium">
              {mode === "create" ? "Mark availability" : "Edit availability"}
            </div>
            <div className="mt-0.5 text-[13px] text-muted">
              {fmtDayLong(day)} · {CLINIC_LABEL[clinic]}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <SectionLabel>THIS TIME IS</SectionLabel>
            <div className="flex gap-1.5">
              {(["open", "block"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold select-none ${
                    kind === k ? "bg-clay text-cream" : "border border-line bg-card text-ink-soft hover:bg-hoverbg"
                  }`}
                >
                  {k === "open" ? "Available" : "Unavailable"}
                </button>
              ))}
            </div>
          </div>

          {kind === "open" && (
            <div className="flex flex-col gap-1.5">
              <SectionLabel>OFFER THIS AS</SectionLabel>
              <div className="flex gap-1.5">
                {(["block", "slot"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFill(f)}
                    className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold select-none ${
                      fill === f ? "bg-clay text-cream" : "border border-line bg-card text-ink-soft hover:bg-hoverbg"
                    }`}
                  >
                    {f === "block" ? "An open block" : "One exact slot"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <SectionLabel>{kind === "open" && fill === "slot" ? "AT" : "FROM"}</SectionLabel>
              <input
                type="time"
                step={900}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`${inputClass} w-[120px]`}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <SectionLabel>TO</SectionLabel>
              <input
                type="time"
                step={900}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`${inputClass} w-[120px]`}
              />
            </label>
          </div>

          <div className="text-[11.5px] text-muted">
            {kind === "block"
              ? "Closes this window — no online bookings land here, even during your usual hours."
              : fill === "slot"
                ? "Offers exactly one bookable start at this time — nothing either side of it. Draw one for each specific time you want to give (e.g. 7:00, then 8:15)."
                : "Opens this window for online booking, filled with start times on your usual spacing, on top of your weekly hours."}
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-hoverbg/40 px-3 py-2.5">
            <input
              type="checkbox"
              checked={repeatWeekly}
              onChange={(e) => setRepeatWeekly(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[12.5px] leading-snug">
              <span className="font-semibold text-ink">Repeat every {weekdayName}</span>
              <span className="block text-[11.5px] text-muted">
                {repeatWeekly
                  ? `Applies to every ${weekdayName} from ${fmtDayLong(day)} onward, until you remove it.`
                  : "Just this one day."}
              </span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <OutlineButton onClick={onClose}>Close</OutlineButton>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Saving…" : mode === "create" ? "Save" : "Update"}
            </PrimaryButton>
            {mode === "edit" && (
              <TintButton className="ml-auto text-[12.5px]" onClick={remove} disabled={deleting}>
                {deleting ? "Removing…" : "Remove"}
              </TintButton>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
