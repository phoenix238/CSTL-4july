"use client";

import { useEffect, useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, useToast } from "./ui";

type Clinic = "waterloo" | "bethnal";

interface SyncState {
  connected: boolean;
  defaultClinic: string;
  lastSyncAt: string | null;
}

/** "just now" / "5 min ago" / "2 h ago" / "3 days ago" for the last-synced line. */
function relative(iso: string | null): string {
  if (!iso) return "not yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Connect and manage the two-way sync between the availability you've offered and
 * a dedicated Google calendar. Self-contained — reads its own state from
 * /api/settings so it doesn't need threading through the whole settings form.
 */
export function AvailabilitySyncCard() {
  const toast = useToast();
  const [state, setState] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState<null | "connect" | "sync">(null);

  useEffect(() => {
    api<{ availabilitySync: SyncState }>("/api/settings")
      .then((s) => setState(s.availabilitySync))
      .catch(() => {});
  }, []);

  async function connect() {
    setBusy("connect");
    try {
      const r = await api<{ connected: boolean; lastSyncAt: string | null }>("/api/availability/connect", {
        method: "POST",
      });
      setState((prev) => ({
        connected: r.connected,
        defaultClinic: prev?.defaultClinic ?? "waterloo",
        lastSyncAt: r.lastSyncAt,
      }));
      toast("Availability calendar connected ✓");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't connect the calendar");
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy("sync");
    try {
      const r = await api<{ lastSyncAt: string | null }>("/api/availability/sync?force=1", { method: "POST" });
      setState((prev) => (prev ? { ...prev, lastSyncAt: r.lastSyncAt ?? prev.lastSyncAt } : prev));
      toast("Synced with Google Calendar ✓");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function setDefaultClinic(clinic: Clinic) {
    setState((prev) => (prev ? { ...prev, defaultClinic: clinic } : prev));
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ availabilityDefaultClinic: clinic }) });
    } catch {
      toast("Couldn't save the default clinic");
    }
  }

  return (
    <Card className="flex flex-col gap-3 px-[18px] py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-ink-soft">See &amp; edit your availability in Google Calendar</div>
        {state?.connected && <span className="text-[11.5px] text-muted">Synced · {relative(state.lastSyncAt)}</span>}
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted">
        Puts the hours you&apos;ve offered onto a &quot;CSTL Availability&quot; calendar in Google and keeps them in step
        both ways: add, move or delete a block in Google and the app picks it up for that date; change your hours here and
        Google updates. Blocks show as free — they never mark you busy.
      </p>

      {!state ? (
        <div className="text-[12.5px] text-muted">Loading…</div>
      ) : !state.connected ? (
        <div>
          <PrimaryButton onClick={connect} disabled={busy === "connect"} className="px-4 py-2 text-[12.5px]">
            {busy === "connect" ? "Connecting…" : "Connect Google Calendar"}
          </PrimaryButton>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium text-ink-soft">
              Clinic for a block you add in Google without naming one
            </div>
            <div className="flex w-fit rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
              {(["bethnal", "waterloo"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setDefaultClinic(c)}
                  className={`cursor-pointer rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
                    state.defaultClinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                  }`}
                >
                  {c === "waterloo" ? "Waterloo" : "Bethnal Green"}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted">
              One calendar covers both clinics, so name the clinic in a block&apos;s title (e.g. &quot;Bethnal
              6–7pm&quot;) and the app reads it; an untitled block uses the clinic above. All-day blocks are ignored —
              give a start and end time.
            </p>
          </div>
          <div>
            <OutlineButton onClick={syncNow} disabled={busy === "sync"} className="px-3.5 py-1.5 text-[12.5px]">
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </OutlineButton>
          </div>
        </div>
      )}
    </Card>
  );
}
