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

interface Segment {
  start: string;
  end: string;
}

interface DayDraft {
  open: boolean;
  // One or more separate windows in the same day — e.g. a day slot and a
  // separate evening slot, with a closed gap between them.
  segments: Segment[];
}

const windowsToDrafts = (windows: WeeklyWindow[]): DayDraft[] =>
  Array.from({ length: 7 }, (_, weekday) => {
    const segments = windows
      .filter((w) => w.weekday === weekday)
      .sort((a, b) => a.startMin - b.startMin)
      .map((w) => ({ start: minToTime(w.startMin), end: minToTime(w.endMin) }));
    return segments.length ? { open: true, segments } : { open: false, segments: [{ start: "09:00", end: "17:00" }] };
  });

const draftsToWindows = (drafts: DayDraft[]): WeeklyWindow[] =>
  drafts.flatMap((d, weekday) =>
    d.open ? d.segments.map((s) => ({ weekday, startMin: timeToMin(s.start), endMin: timeToMin(s.end) })) : [],
  );

export function AvailabilitySettings({
  weeklyHours,
  overrides: initialOverrides,
  bookingSlotMinutes,
  bookingMinNoticeMins,
  bookingHorizonDays,
  bookingBufferMinutes,
  bethnalBufferMinutes,
  chalkFarmBufferMinutes,
  chalkFarmEdgeBufferMinutes,
  chalkFarmWeeklyCapHours,
  crossClinicGapMinutes,
  bookingNotifyEmail,
  baseUrl,
}: {
  weeklyHours: WeeklyHours;
  overrides: AvailabilityOverrideDTO[];
  bookingSlotMinutes: number;
  bookingMinNoticeMins: number;
  bookingHorizonDays: number;
  bookingBufferMinutes: number;
  bethnalBufferMinutes: number;
  chalkFarmBufferMinutes: number;
  chalkFarmEdgeBufferMinutes: number;
  chalkFarmWeeklyCapHours: number;
  crossClinicGapMinutes: number;
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

  const toggleDayOpen = (i: number, open: boolean) => {
    setDrafts((prev) => ({
      ...prev,
      [hoursClinic]: prev[hoursClinic].map((d, idx) => (idx === i ? { ...d, open } : d)),
    }));
    setHoursDirty(true);
  };

  const updateSegment = (i: number, segIdx: number, patch: Partial<Segment>) => {
    setDrafts((prev) => ({
      ...prev,
      [hoursClinic]: prev[hoursClinic].map((d, idx) =>
        idx === i ? { ...d, segments: d.segments.map((s, si) => (si === segIdx ? { ...s, ...patch } : s)) } : d,
      ),
    }));
    setHoursDirty(true);
  };

  // New segment defaults to an evening slot — the day slot is usually added first.
  const addSegment = (i: number) => {
    setDrafts((prev) => ({
      ...prev,
      [hoursClinic]: prev[hoursClinic].map((d, idx) =>
        idx === i ? { ...d, segments: [...d.segments, { start: "17:00", end: "21:00" }] } : d,
      ),
    }));
    setHoursDirty(true);
  };

  const removeSegment = (i: number, segIdx: number) => {
    setDrafts((prev) => ({
      ...prev,
      [hoursClinic]: prev[hoursClinic].map((d, idx) =>
        idx === i ? { ...d, segments: d.segments.filter((_, si) => si !== segIdx) } : d,
      ),
    }));
    setHoursDirty(true);
  };

  async function saveHours() {
    // Guard against end ≤ start on any segment — the server silently drops such
    // windows, so without this the day would quietly fail to save under a "saved ✓" toast.
    const invalid = new Set<string>();
    (["waterloo", "bethnal"] as const).forEach((c) => {
      drafts[c].forEach((d, i) => {
        if (!d.open) return;
        for (const s of d.segments) {
          if (timeToMin(s.end) <= timeToMin(s.start)) {
            invalid.add(`${c === "waterloo" ? "Waterloo" : "Bethnal Green"} ${WEEKDAY_LABELS[i]}`);
          }
        }
      });
    });
    if (invalid.size) {
      toast(`End time must be after the start — check ${[...invalid].join(", ")}`);
      return;
    }
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
    bethnalBufferMinutes,
    chalkFarmBufferMinutes,
    chalkFarmEdgeBufferMinutes,
    chalkFarmWeeklyCapHours,
    crossClinicGapMinutes,
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
          bethnalBufferMinutes: tuning.bethnalBufferMinutes,
          chalkFarmBufferMinutes: tuning.chalkFarmBufferMinutes,
          chalkFarmEdgeBufferMinutes: tuning.chalkFarmEdgeBufferMinutes,
          chalkFarmWeeklyCapHours: tuning.chalkFarmWeeklyCapHours,
          crossClinicGapMinutes: tuning.crossClinicGapMinutes,
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
            <div key={i} className="flex flex-wrap items-start gap-2.5 border-b border-hairline py-1.5 last:border-0">
              <label className="flex w-[80px] shrink-0 cursor-pointer items-center gap-1.5 pt-[7px] text-[12.5px] font-medium">
                <input type="checkbox" checked={d.open} onChange={(e) => toggleDayOpen(i, e.target.checked)} />
                {WEEKDAY_LABELS[i]}
              </label>
              <div className="flex flex-col gap-1.5 py-[3px]">
                {(d.open ? d.segments : d.segments.slice(0, 1)).map((s, si) => (
                  <div key={si} className="flex items-center gap-2">
                    <input
                      type="time"
                      step={1800}
                      value={s.start}
                      disabled={!d.open}
                      onChange={(e) => updateSegment(i, si, { start: e.target.value })}
                      className={`${inputClass} w-[110px] disabled:opacity-40`}
                    />
                    <span className="text-[12px] text-muted">to</span>
                    <input
                      type="time"
                      step={1800}
                      value={s.end}
                      disabled={!d.open}
                      onChange={(e) => updateSegment(i, si, { end: e.target.value })}
                      className={`${inputClass} w-[110px] disabled:opacity-40`}
                    />
                    {d.open && d.segments.length > 1 && (
                      <button
                        onClick={() => removeSegment(i, si)}
                        aria-label={`Remove this ${WEEKDAY_LABELS[i]} time`}
                        className="cursor-pointer text-[14px] font-semibold text-muted hover:text-clay-text"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {d.open && (
                  <button
                    onClick={() => addSegment(i)}
                    className="cursor-pointer self-start text-[11.5px] font-semibold text-clay-text hover:text-clay"
                  >
                    + Add another time (e.g. an evening slot)
                  </button>
                )}
              </div>
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
          label="Gap between your own Waterloo clients"
          value={tuning.bufferMinutes}
          display={tuning.bufferMinutes === 0 ? "None — back-to-back OK" : `${tuning.bufferMinutes} min`}
          min={0}
          max={30}
          step={5}
          hint="Minimum breathing room kept before and after every Waterloo session. Set to None to let clients book back-to-back there."
          onChange={(v) => {
            setTuning((p) => ({ ...p, bufferMinutes: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Gap between your own Bethnal Green clients"
          value={tuning.bethnalBufferMinutes}
          display={tuning.bethnalBufferMinutes === 0 ? "None — back-to-back OK" : `${tuning.bethnalBufferMinutes} min`}
          min={0}
          max={30}
          step={5}
          hint="Minimum breathing room kept before and after every Bethnal Green session — independent of the Waterloo gap above, since the shared Chalk Farm room may need different spacing."
          onChange={(v) => {
            setTuning((p) => ({ ...p, bethnalBufferMinutes: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Travel time between the two clinics"
          value={tuning.crossClinicGapMinutes}
          display={tuning.crossClinicGapMinutes === 0 ? "None" : `${tuning.crossClinicGapMinutes} min`}
          min={0}
          max={180}
          step={15}
          hint="Working a morning at one clinic and an evening at the other is fine — this is the clearance kept around a session at the other site, so nobody can book the two so close together that you can't make the journey."
          onChange={(v) => {
            setTuning((p) => ({ ...p, crossClinicGapMinutes: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Gap from a Chalk Farm studio-mate's booking"
          value={tuning.chalkFarmBufferMinutes}
          display={tuning.chalkFarmBufferMinutes === 0 ? "None" : `${tuning.chalkFarmBufferMinutes} min`}
          min={0}
          max={60}
          step={5}
          hint="Bethnal Green only, incoming direction. When someone else (e.g. Amy) already has the shared Chalk Farm calendar booked, this much clearance is kept either side of THEIR booking before you can book — on top of the gap above."
          onChange={(v) => {
            setTuning((p) => ({ ...p, chalkFarmBufferMinutes: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Chalk Farm block edge padding"
          value={tuning.chalkFarmEdgeBufferMinutes}
          display={tuning.chalkFarmEdgeBufferMinutes === 0 ? "None" : `${tuning.chalkFarmEdgeBufferMinutes} min`}
          min={0}
          max={30}
          step={5}
          hint="Bethnal Green only, outgoing direction. Your daily 'Phoenix' block on the shared Chalk Farm calendar starts this much before your first client and ends this much after your last, so studio-mates see clearance and don't book right onto the front or back of your day."
          onChange={(v) => {
            setTuning((p) => ({ ...p, chalkFarmEdgeBufferMinutes: v }));
            setTuningDirty(true);
          }}
        />
        <TuningSlider
          label="Weekly Chalk Farm hours cap"
          value={tuning.chalkFarmWeeklyCapHours}
          display={tuning.chalkFarmWeeklyCapHours === 0 ? "No cap" : `${tuning.chalkFarmWeeklyCapHours} hrs/week`}
          min={0}
          max={30}
          step={1}
          hint="Bethnal Green only. Counts the actual Chalk Farm room time held each Monday–Sunday week — from the edge padding before your first session to after your last, gaps between sessions included, not just the session hours. Once a week reaches this many hours, no further Bethnal slots are offered that week on the public page, portal, or offer-pick link. Doesn't stop you booking over it yourself from QuickBook or Enquiries."
          onChange={(v) => {
            setTuning((p) => ({ ...p, chalkFarmWeeklyCapHours: v }));
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
