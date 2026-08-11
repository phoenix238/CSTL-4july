"use client";

import { useState } from "react";
import { api, OutlineButton, useToast } from "./ui";

/**
 * One-off: strip client names from calendar events booked before names came off
 * the calendar. New bookings are already anonymous; this fixes the back-catalogue.
 */
export function RenameCalendarEventsButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const { updated, scanned } = await api<{ updated: number; scanned: number }>(
        "/api/calendar/rename-events",
        { method: "POST" },
      );
      toast(
        scanned === 0
          ? "No upcoming events to update"
          : `Renamed ${updated} of ${scanned} upcoming session${scanned === 1 ? "" : "s"} ✓`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't rename events");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
      <OutlineButton disabled={busy} onClick={run} className="self-start">
        {busy ? "Renaming…" : "Anonymise existing calendar events"}
      </OutlineButton>
      <p className="text-[11.5px] text-muted">
        New bookings already show as “Craniosacral therapy” with no name. This updates upcoming sessions booked
        earlier — you’ll still see who each one is with in Today and This Week.
      </p>
    </div>
  );
}
