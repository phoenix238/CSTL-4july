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
  | "booking-page";

const TYPES: { key: TestType; label: string }[] = [
  { key: "first", label: "First booking" },
  { key: "returning", label: "Rebooking" },
  { key: "cancellation", label: "Cancellation" },
  { key: "moved", label: "Session moved" },
  { key: "booking-page", label: "Booking page link" },
  { key: "receipt", label: "Receipt" },
  { key: "reminder", label: "Payment reminder" },
  { key: "session-reminder", label: "Session reminder" },
  { key: "review", label: "Review request" },
];

/**
 * Send yourself any of the client emails, composed from your real settings with
 * a sample client — the way to read each one without booking a real person.
 */
export function TestEmailPanel() {
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
