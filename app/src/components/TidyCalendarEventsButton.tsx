"use client";

import { useState } from "react";
import { api, OutlineButton, useToast } from "./ui";

/**
 * One-off: bring sessions booked earlier in line with what new bookings already
 * get — no client name in the title, and the clinic's colour.
 */
export function TidyCalendarEventsButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const { updated, scanned } = await api<{ updated: number; scanned: number }>(
        "/api/calendar/restyle-events",
        { method: "POST" },
      );
      toast(
        scanned === 0
          ? "No upcoming events to update"
          : `Updated ${updated} of ${scanned} upcoming session${scanned === 1 ? "" : "s"} ✓`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update events");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
      <OutlineButton disabled={busy} onClick={run} className="self-start">
        {busy ? "Updating…" : "Tidy up existing calendar events"}
      </OutlineButton>
      <p className="text-[11.5px] text-muted">
        New bookings already show as “Craniosacral therapy” with no name, in pink for Bethnal Green and orange for
        Waterloo. This gives upcoming sessions booked earlier the same treatment — you’ll still see who each one is
        with in Today and This Week.
      </p>
    </div>
  );
}
