"use client";

import { useState } from "react";
import { api, Card, OutlineButton, useToast } from "./ui";
import { useActiveSpaces } from "./SpacesContext";

type TestType =
  | "first"
  | "returning"
  | "cancellation"
  | "moved"
  | "receipt"
  | "reminder"
  | "session-reminder"
  | "review"
  | "booking-page"
  | "first-session"
  | "first-session-done"
  | "no-show";

const TYPES: { key: TestType; label: string }[] = [
  { key: "first", label: "First booking" },
  { key: "returning", label: "Rebooking" },
  { key: "cancellation", label: "Cancellation" },
  { key: "moved", label: "Session moved" },
  { key: "booking-page", label: "Booking page link" },
  { key: "receipt", label: "Receipt" },
  { key: "reminder", label: "Payment reminder" },
  { key: "session-reminder", label: "Session reminder" },
  { key: "first-session", label: "First session — intake not done" },
  { key: "first-session-done", label: "First session — intake done" },
  { key: "no-show", label: "No-show" },
  { key: "review", label: "Review request" },
];

/**
 * Send yourself any of the client emails, composed from your real settings with
 * a sample client — the way to read each one without booking a real person.
 */
type Due = { clientName: string; whenLabel: string };
interface RunResult {
  dryRun: boolean;
  firstSession: { due: Array<Due & { intakeDone: boolean }>; sent: number };
  reminders: { due: Array<Due & { leadDays: number[] }>; sent: number };
}

/**
 * Run today's client emails now — what the 6am daily job would send — so you
 * can see reminders work without waiting for the morning. "Check" lists who's
 * due without emailing anyone; "Send" sends them. Nothing is ever sent twice.
 */
function RunRemindersNow() {
  const toast = useToast();
  const [busy, setBusy] = useState<"check" | "send" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "check" : "send");
    try {
      const r = await api<RunResult>("/api/reminders/run", { method: "POST", body: JSON.stringify({ dryRun }) });
      setResult(r);
      if (!dryRun) toast(`Sent ${r.firstSession.sent + r.reminders.sent} email${r.firstSession.sent + r.reminders.sent === 1 ? "" : "s"} ✓`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't run them");
    } finally {
      setBusy(null);
    }
  }

  const due = result ? [...result.firstSession.due, ...result.reminders.due] : [];
  return (
    <Card className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">Today&apos;s reminder emails</span>
        <p className="text-[12px] leading-relaxed text-muted">
          Sent automatically early every morning (about 6–7am): a &ldquo;looking forward to meeting you&rdquo; email the day
          before a new client&apos;s first session, and the reminders clients have switched on. Check who&apos;s due
          today, or send them now rather than waiting for the morning — nobody is ever emailed twice.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <OutlineButton disabled={busy !== null} onClick={() => run(true)}>
          {busy === "check" ? "Checking…" : "Check who's due"}
        </OutlineButton>
        <OutlineButton disabled={busy !== null} onClick={() => run(false)}>
          {busy === "send" ? "Sending…" : "Send today's now"}
        </OutlineButton>
      </div>
      {result && (
        <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
          {due.length === 0 ? (
            "Nobody is due a reminder today."
          ) : (
            <ul className="flex flex-col gap-0.5">
              {result.firstSession.due.map((d) => (
                <li key={`f-${d.clientName}-${d.whenLabel}`}>
                  {d.clientName} — first session {d.whenLabel} ({d.intakeDone ? "intake done" : "intake not done yet"})
                </li>
              ))}
              {result.reminders.due.map((d) => (
                <li key={`r-${d.clientName}-${d.whenLabel}`}>
                  {d.clientName} — reminder for {d.whenLabel}
                </li>
              ))}
            </ul>
          )}
          {!result.dryRun && <div className="mt-1 font-semibold">Sent ✓</div>}
        </div>
      )}
    </Card>
  );
}

export function TestEmailPanel() {
  return (
    <div className="flex flex-col gap-2.5">
      <RunRemindersNow />
      <TestEmailButtons />
    </div>
  );
}

function TestEmailButtons() {
  const toast = useToast();
  const spaces = useActiveSpaces();
  const [picked, setPicked] = useState(spaces[0]?.id ?? "");
  // The space picked, or the first open one if it's since been archived.
  const clinic = spaces.some((sp) => sp.id === picked) ? picked : (spaces[0]?.id ?? "");
  const [busy, setBusy] = useState<TestType | null>(null);

  async function send(type: TestType) {
    setBusy(type);
    try {
      const { sentTo } = await api<{ sentTo: string }>("/api/settings/test-email", {
        method: "POST",
        body: JSON.stringify({ type, clinic }),
      });
      toast(`Test email sent to ${sentTo} ✓`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send the test");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 px-4 py-3.5">
      <p className="text-[12px] leading-relaxed text-muted">
        Send yourself any of these, built from your current settings with a sample client, so you can read exactly what
        a client gets. They always go to your own inbox.
      </p>
      {spaces.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">Space:</span>
          <div className="flex max-w-full flex-wrap rounded-[18px] border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
            {spaces.map((sp) => (
              <button
                key={sp.id}
                onClick={() => setPicked(sp.id)}
                className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-semibold ${
                  clinic === sp.id ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                }`}
              >
                {sp.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <OutlineButton key={t.key} disabled={busy !== null} onClick={() => send(t.key)}>
            {busy === t.key ? "Sending…" : t.label}
          </OutlineButton>
        ))}
      </div>
    </Card>
  );
}
