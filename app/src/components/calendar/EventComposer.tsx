"use client";

import { useState } from "react";
import { fmtDayLong, fmtTime, londonYMD, londonTime } from "@/lib/time";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, TintButton, inputClass, useToast } from "../ui";
import type { SpanSource } from "./layout";

export type EventCalendar = "personal" | "room" | "chalkFarm";

const CAL_LABEL: Record<EventCalendar, string> = {
  personal: "My calendar",
  room: "R5 room",
  chalkFarm: "Chalk Farm",
};

/** Combine a reference day (from `base`) with an "HH:MM" wall-clock time. */
function atTime(base: Date, hhmm: string): Date {
  const { y, m, d } = londonYMD(base);
  const [h, min] = hhmm.split(":").map(Number);
  return londonTime(y, m, d, h || 0, min || 0);
}

/**
 * Create a plain calendar event (drag-selected on the grid) or edit/delete an
 * existing Google event in place — the general-purpose counterpart to QuickBook,
 * which is only for client bookings.
 */
export function EventComposer({
  mode,
  start,
  end,
  title: initialTitle = "",
  eventId,
  source,
  calendars,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  start: Date;
  end: Date;
  title?: string;
  eventId?: string;
  /** edit mode: which calendar the event lives on */
  source?: SpanSource;
  /** create mode: which calendars are wired up */
  calendars: Record<EventCalendar, boolean>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const available = (["personal", "room", "chalkFarm"] as const).filter((c) => calendars[c]);
  const [calendar, setCalendar] = useState<EventCalendar>(
    (source as EventCalendar) || available[0] || "personal",
  );
  const [title, setTitle] = useState(initialTitle);
  const [startTime, setStartTime] = useState(fmtTime(start));
  const [endTime, setEndTime] = useState(fmtTime(end));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    const s = atTime(start, startTime);
    // Anchor the end on `end`'s own date, not `start`'s — otherwise an event
    // that ends at/after midnight resolves before its start and can't be saved.
    const e = atTime(end, endTime);
    if (e <= s) {
      toast("End time must be after the start");
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        await api("/api/events", {
          method: "POST",
          body: JSON.stringify({ calendar, title, startISO: s.toISOString(), endISO: e.toISOString() }),
        });
        toast("Event added ✓");
      } else {
        await api("/api/events", {
          method: "PATCH",
          body: JSON.stringify({ calendar, eventId, title, startISO: s.toISOString(), endISO: e.toISOString() }),
        });
        toast("Event updated ✓");
      }
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that");
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this event from your calendar?")) return;
    setDeleting(true);
    try {
      await api("/api/events", {
        method: "DELETE",
        body: JSON.stringify({ calendar, eventId }),
      });
      toast("Event deleted");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete that");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[oklch(0.3_0.02_60_/_0.18)]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2">
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <div className="font-serif text-[19px] font-medium">{mode === "create" ? "New event" : "Edit event"}</div>
            <div className="mt-0.5 text-[13px] text-muted">{fmtDayLong(start)}</div>
          </div>

          <label className="flex flex-col gap-1.5">
            <SectionLabel>TITLE</SectionLabel>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Supervision with Liz"
              className={inputClass}
            />
          </label>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <SectionLabel>FROM</SectionLabel>
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

          {mode === "create" && available.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <SectionLabel>CALENDAR</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {available.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCalendar(c)}
                    className={`cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-semibold select-none ${
                      calendar === c ? "bg-clay text-cream" : "border border-line bg-card text-ink-soft hover:bg-hoverbg"
                    }`}
                  >
                    {CAL_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <OutlineButton onClick={onClose}>Close</OutlineButton>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Saving…" : mode === "create" ? "Add event" : "Save"}
            </PrimaryButton>
            {mode === "edit" && (
              <TintButton className="ml-auto text-[12.5px]" onClick={remove} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </TintButton>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
