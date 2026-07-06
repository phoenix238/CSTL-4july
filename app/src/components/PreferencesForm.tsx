"use client";

import { useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, useToast } from "./ui";

export function PreferencesForm({
  token,
  clientName,
  initialMarketing,
}: {
  token: string;
  clientName: string;
  initialMarketing: boolean;
}) {
  const toast = useToast();
  const [done, setDone] = useState<null | boolean>(null);
  const [saving, setSaving] = useState(false);

  async function choose(marketing: boolean) {
    setSaving(true);
    try {
      await api(`/api/preferences/${token}`, { method: "POST", body: JSON.stringify({ marketing }) });
      setDone(marketing);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong — please try again");
    } finally {
      setSaving(false);
    }
  }

  if (done !== null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
          ✓
        </div>
        <div className="font-serif text-2xl font-medium">{done ? "You're on the list" : "All done"}</div>
        <p className="text-[14px] leading-relaxed text-muted">
          {done
            ? "Thank you — you'll get the occasional note about offers and clinic news. You can change your mind any time."
            : "No problem — you won't receive marketing emails. Thank you!"}
        </p>
      </div>
    );
  }

  const first = clientName?.trim()?.split(/\s+/)[0] || "there";

  return (
    <div className="mx-auto flex min-h-screen max-w-[520px] flex-col items-center justify-center px-5">
      <Card className="flex w-full flex-col gap-4 px-6 py-7 text-center">
        <h1 className="font-serif text-[24px] leading-[1.15]">Hi {first} 👋</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          Would you like the occasional email from Phoenix Tanner CSTL — offers, clinic news, the odd
          craniosacral tip? No spam, and you can opt out any time.
        </p>
        <div className="flex flex-col gap-2.5 pt-1">
          <PrimaryButton onClick={() => choose(true)} disabled={saving} className="py-3">
            {initialMarketing ? "Yes — keep me on the list" : "Yes please, keep me posted"}
          </PrimaryButton>
          <OutlineButton onClick={() => choose(false)} disabled={saving} className="py-2.5">
            No thanks
          </OutlineButton>
        </div>
      </Card>
    </div>
  );
}
