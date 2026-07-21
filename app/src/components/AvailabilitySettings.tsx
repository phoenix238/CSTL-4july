"use client";

import { useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, inputClass, useToast } from "./ui";
import type { WeeklyHours, WeeklyWindow } from "@/lib/booking/availability";

type ClinicKey = "waterloo" | "bethnal";

export interface AvailabilityOverrideDTO {
  id: string;
  clinic: string;
  date: string;
  kind: string;
  startMin: number;
  endMin: number;
  note: string;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const minToTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

interface DayDraft {
  open: boolean;
  start: string;
  end: string;
}

const windowsToDrafts = (windows: WeeklyWindow[]): DayDraft[] =>
  Array.from({ length: 7 }, (_, weekday) => {
    const w = windows.find((w) => w.weekday === weekday);
    return w ? { open: true, start: minToTime(w.startMin), end: minToTime(w.endMin) } : { open: false, start: "09:00", end: "17:00" };
  });

const draftsToWindows = (drafts: DayDraft[]): WeeklyWindow[] =>
  drafts.flatMap((d, weekday) => (d.open ? [{ weekday, startMin: timeToMin(d.start), endMin: timeToMin(d.end) }] : []));

export function AvailabilitySettings({
  weeklyHours,
  overrides: initialOverrides,
  bookingSlotMinutes,
  bookingMinNoticeMins,
  bookingHorizonDays,
  bookingBufferMinutes,
  bookingNotifyEmail,
  baseUrl,
}: {
  weeklyHours: WeeklyHours;
  overrides: AvailabilityOverrideDTO[];
  bookingSlotMinutes: number;
  bookingMinNoticeMins: number;
  bookingHorizonDays: number;
  bookingBufferMinutes: number;
  bookingNotifyEmail: boolean;
  baseUrl: string;
}) {
  const toast = useToast();
  const bookingLink = `${baseUrl}/book`;

  /* ---------- weekly hours ---------- */
  const [hoursClinic, setHoursClinic] = useState<ClinicKey>("bethnal");
  const [drafts, setDrafts] = useState<Record<ClinicKey, DayDraft[]>>({
    waterloo: windowsToDrafts(weeklyHours.waterloo),
    bethnal: windowsToDrafts(weeklyHours.bethnal),
  });
  const [hoursDirty, setHoursDirty] = useState(false);
  const [savingHours, setSavingHours] = useState(false);

  const updateDay = (i: number, patch: Partial<DayDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [hoursClinic]: prev[hoursClinic].map((d, idx) => (idx === i ? { ...d, ...patch } : d)),
    }));
    setHoursDirty(true);
  };

  async function saveHours() {
    setSavingHours(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          weeklyHours: { waterloo: draftsToWindows(drafts.waterloo), bethnal: draftsToWindows(drafts.bethnal) },
        }),
      });
      toast("Weekly hours saved ✓");
      setHoursDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSavingHours(false);
    }
  }

  /* ---------- date overrides ---------- */
  const [overrides, setOverrides] = useState(initialOverrides);
  const [newOverride, setNewOverride] = useState({
    clinic: "bethnal" as ClinicKey,
    date: "",
    kind: "block" as "open" | "block",
    allDay: true,
    start: "09:00",
    end: "17:00",
    note: "",
  });
  const [addingOverride, setAddingOverride] = useState(false);

  async function addOverride() {
    if (!newOverride.date) {
      toast("Pick a date first");
      return;
    }
    setAddingOverride(true);
    try {
      const { override } = await api<{ override: AvailabilityOverrideDTO }>("/api/availability-overrides", {
        method: "POST",
        body: JSON.stringify({
          clinic: newOverride.clinic,
          date: newOverride.date,
          kind: newOverride.kind,
          startMin: newOverride.allDay ? 0 : timeToMin(newOverride.start),
          endMin: newOverride.allDay ? 1440 : timeToMin(newOverride.end),
          note: newOverride.note,
        }),
      });
      setOverrides((prev) => [...prev, override].sort((a, b) => a.date.localeCompare(b.date)));
      setNewOverride((prev) => ({ ...prev, date: "", note: "" }));
      toast("Added ✓");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add that");
    } finally {
      setAddingOverride(false);
    }
  }

  async function removeOverride(id: string) {
    try {
      await api(`/api/availability-overrides/${id}`, { method: "DELETE" });
      setOverrides((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove that");
    }
  }

  /* ---------- booking tuning ---------- */
  const [tuning, setTuning] = useState({
    slotMinutes: bookingSlotMinutes,
    minNoticeHours: Math.round(bookingMinNoticeMins / 60),
    horizonDays: bookingHorizonDays,
    bufferMinutes: bookingBufferMinutes,
    notifyEmail: bookingNotifyEmail,
  });
  const [tuningDirty, setTuningDirty] = useState(false);
  const [savingTuning, setSavingTuning] = useState(false);

  async function saveTuning() {
    setSavingTuning(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          bookingSlotMinutes: tuning.slotMinutes,
          bookingMinNoticeMins: tuning.minNoticeHours * 60,
          bookingHorizonDays: tuning.horizonDays,
          bookingBufferMinutes: tuning.bufferMinutes,
          bookingNotifyEmail: tuning.notifyEmail,
        }),
      });
      toast("Booking tuning saved ✓");
      setTuningDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSavingTuning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="text-[13px]">
          <div className="font-semibold text-ink">Your public booking link</div>
          <div className="font-mono text-[12px] text-muted">{bookingLink}</div>
        </div>
        <OutlineButton
          onClick={() => {
            navigator.clipboard.writeText(bookingLink);
            toast("Link copied ✓");
          }}
          className="px-3.5 py-1.5 text-[12.5px]"
        >
          Copy link
        </OutlineButton>
      </Card>

      <Card className="flex flex-col gap-3 px-[18px] py-4">
        <div className="text-[12px] font-semibold text-ink-soft">Weekly hours</div>
        <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
          {(["bethnal", "waterloo"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setHoursClinic(c)}
              className={`cursor-pointer rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
                hoursClinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
              }`}
            >
              {c === "waterloo" ? "Waterloo" : "Bethnal Green"}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {drafts[hoursClinic].map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2.5 border-b border-hairline py-1.5 last:border-0">
              <label className="flex w-[80px] cursor-pointer items-center gap-1.5 text-[12.5px] font-medium">
                <input type="checkbox" checked={d.open} onChange={(e) => updateDay(i, { open: e.target.checked })} />
                {WEEKDAY_LABELS[i]}
              </label>
              <input
                type="time"
                step={1800}
                value={d.start}
                disabled={!d.open}
                onChange={(e) => updateDay(i, { start: e.target.value })}
                className={`${inputClass} w-[110px] disabled:opacity-40`}
              />
              <span className="text-[12px] text-muted">to</span>
              <input
                type="time"
                step={1800}
                value={d.end}
                disabled={!d.open}
                onChange={(e) => updateDay(i, { end: e.target.value })}
                className={`${inputClass} w-[110px] disabled:opacity-40`}
              />
            </div>
          ))}
        </div>
        <PrimaryButton onClick={saveHours} disabled={!hoursDirty || savingHours} className="self-start px-4 py-1.5 text-[12.5px]">
          {savingHours ? "Saving…" : "Save hours"}
        </PrimaryButton>
        {hoursClinic === "bethnal" && (
          <div className="text-[11.5px] text-muted">
            The shared &quot;Phoenix&quot; block on your Chalk Farm calendar grows and shrinks automatically to fit
            that day&apos;s Bethnal Green sessions — book clients as close together as you like (use the buffer
            slider below for breathing room between them).
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 px-[18px] py-4">
        <div className="text-[12px] font-semibold text-ink-soft">Date overrides — close a day, or open an extra one</div>
        {overrides.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {overrides.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 border-b border-hairline py-1.5 text-[12.5px] last:border-0">
                <span className={`font-semibold ${o.kind === "block" ? "text-[oklch(0.55_0.15_25)]" : "text-sage-text"}`}>
                  {o.kind === "block" ? "Blocked" : "Open"}
                </span>
                <span>{o.date}</span>
                <span className="text-muted">{o.clinic === "waterloo" ? "Waterloo" : "Bethnal Green"}</span>
                <span className="text-muted">
                  {o.startMin === 0 && o.endMin === 1440 ? "all day" : `${minToTime(o.startMin)}–${minToTime(o.endMin)}`}
                </span>
                {o.note && <span className="text-faint">{o.note}</span>}
                <button
                  onClick={() => removeOverride(o.id)}
                  className="ml-auto cursor-pointer text-[12px] font-semibold text-muted hover:text-[oklch(0.55_0.15_25)]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">DATE</span>
            <input
              type="date"
              value={newOverride.date}
              onChange={(e) => setNewOverride((p) => ({ ...p, date: e.target.value }))}
              className={`${inputClass} w-[150px]`}
            />
          </label>
          <select
            value={newOverride.clinic}
            onChange={(e) => setNewOverride((p) => ({ ...p, clinic: e.target.value as ClinicKey }))}
            className="cursor-pointer rounded-lg border border-inputline bg-inputbg px-2 py-2 text-[12.5px]"
          >
            <option value="bethnal">Bethnal Green</option>
            <option value="waterloo">Waterloo</option>
          </select>
          <select
            value={newOverride.kind}
            onChange={(e) => setNewOverride((p) => ({ ...p, kind: e.target.value as "open" | "block" }))}
            className="cursor-pointer rounded-lg border border-inputline bg-inputbg px-2 py-2 text-[12.5px]"
          >
            <option value="block">Block / close</option>
            <option value="open">Open extra</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={newOverride.allDay}
              onChange={(e) => setNewOverride((p) => ({ ...p, allDay: e.target.checked }))}
            />
            All day
          </label>
          {!newOverride.allDay && (
            <>
              <input
                type="time"
                step={1800}
                value={newOverride.start}
                onChange={(e) => setNewOverride((p) => ({ ...p, start: e.target.value }))}
                className={`${inputClass} w-[110px]`}
              />
              <input
                type="time"
                step={1800}
                value={newOverride.end}
                onChange={(e) => setNewOverride((p) => ({ ...p, end: e.target.value }))}
                className={`${inputClass} w-[110px]`}
              />
            </>
          )}
          <input
            value={newOverride.note}
            onChange={(e) => setNewOverride((p) => ({ ...p, note: e.target.value }))}
            placeholder="Note (optional)"
            className={`${inputClass} min-w-[140px] flex-1`}
          />
          <OutlineButton onClick={addOverride} disabled={addingOverride} className="px-3.5 py-2 text-[12.5px]">
            {addingOverride ? "Adding…" : "+ Add"}
          </OutlineButton>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 px-[18px] py-4">
        <div className="text-[12px] font-semibold text-ink-soft">Booking tuning</div>

        <TuningSlider
          label="Slot length"
          value={tuning.slotMinutes}
          display={`${tuning.slotMinutes} min`}
          min={15}
          max={60}
          step={15}
          hint="How often a bookable start time appears."
          onChange={(v) => {
            setTuning((p) => ({ ...p, slotMinutes: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Minimum notice"
          value={tuning.minNoticeHours}
          display={tuning.minNoticeHours === 0 ? "None" : `${tuning.minNoticeHours}h`}
          min={0}
          max={48}
          step={1}
          hint="Nobody can book inside this window from right now."
          onChange={(v) => {
            setTuning((p) => ({ ...p, minNoticeHours: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Booking horizon"
          value={tuning.horizonDays}
          display={`${tuning.horizonDays} days`}
          min={7}
          max={60}
          step={1}
          hint="How far ahead the public page shows and allows booking."
          onChange={(v) => {
            setTuning((p) => ({ ...p, horizonDays: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Buffer around sessions"
          value={tuning.bufferMinutes}
          display={tuning.bufferMinutes === 0 ? "None" : `${tuning.bufferMinutes} min`}
          min={0}
          max={30}
          step={5}
          hint="Extra padding either side of every session, on top of the calendar footprint — breathing room between clients."
          onChange={(v) => {
            setTuning((p) => ({ ...p, bufferMinutes: v }));
            setTuningDirty(true);
          }}
        />

        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-ink">
          <input
            type="checkbox"
            checked={tuning.notifyEmail}
            onChange={(e) => {
              setTuning((p) => ({ ...p, notifyEmail: e.target.checked }));
              setTuningDirty(true);
            }}
          />
          Email me when someone books online
        </label>

        <PrimaryButton onClick={saveTuning} disabled={!tuningDirty || savingTuning} className="self-start px-4 py-1.5 text-[12.5px]">
          {savingTuning ? "Saving…" : "Save tuning"}
        </PrimaryButton>
        <div className="text-[11.5px] text-muted">
          Change a slider, save, check {bookingLink}, adjust again — these tune themselves best through experience.
        </div>
      </Card>
    </div>
  );
}

function TuningSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="text-[12px] font-semibold text-clay-text">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-[oklch(0.58_0.115_42)]"
      />
      <span className="text-[11.5px] text-muted">{hint}</span>
    </div>
  );
}
