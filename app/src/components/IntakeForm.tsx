"use client";

import { useState } from "react";
import { api, Card, PrimaryButton, inputClass, useToast } from "./ui";

const FIELDS: Array<[string, string, string?]> = [
  ["name", "Full name"],
  ["dob", "Date of birth", "e.g. 14/03/1990"],
  ["phone", "Phone number"],
  ["occupation", "Occupation"],
  ["doctor", "GP / doctor (name & surgery)"],
  ["meds", "Any medications you take"],
  ["conditions", "Health conditions / injuries I should know about"],
  ["emergency", "Emergency contact (name & number)"],
  ["referred", "How did you hear about me?"],
];

export function IntakeForm({
  token,
  clientName,
  clientPhone,
  alreadyDone,
}: {
  token: string;
  clientName: string;
  clientPhone: string;
  alreadyDone: boolean;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({
    name: clientName,
    phone: clientPhone,
  });
  const [caseHistory, setCaseHistory] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    if (!values.name?.trim()) {
      toast("Please add your name");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/intake/${token}`, {
        method: "POST",
        body: JSON.stringify({ ...values, caseHistory, marketing }),
      });
      setDone(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send that — please try again");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
          ✓
        </div>
        <div className="font-serif text-2xl font-medium">Thank you</div>
        <p className="text-[14px] leading-relaxed text-muted">
          Your details are with Phoenix. Looking forward to seeing you.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[600px] px-5 py-10">
      <header className="mb-6 text-center">
        <h1 className="font-serif text-[28px] leading-[1.1]">Your intake form</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          A few details before your craniosacral session with Phoenix Tanner. Everything here is private
          and kept in your confidential record.
        </p>
        {alreadyDone && (
          <p className="mt-3 rounded-xl bg-sage-tint px-3.5 py-2 text-[12.5px] text-sage-text">
            You&apos;ve filled this in before — you can update anything that&apos;s changed.
          </p>
        )}
      </header>

      <Card className="flex flex-col gap-4 px-5 py-6">
        {FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink-soft">{label}</span>
            {key === "meds" || key === "conditions" ? (
              <textarea
                value={values[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                className={`${inputClass} min-h-[70px] resize-y`}
              />
            ) : (
              <input
                value={values[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                className={inputClass}
              />
            )}
          </label>
        ))}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink-soft">
            What brings you to therapy — anything you&apos;d like me to know
          </span>
          <textarea
            value={caseHistory}
            onChange={(e) => setCaseHistory(e.target.value)}
            placeholder="In your own words — what you'd like to work on, how you're feeling, anything relevant…"
            className={`${inputClass} min-h-[130px] resize-y leading-[1.55]`}
          />
        </label>

        <label className="flex items-start gap-2.5 text-[13px] leading-snug">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5"
          />
          <span>I&apos;m happy to receive occasional emails about offers and clinic news (optional).</span>
        </label>

        <PrimaryButton onClick={submit} disabled={saving} className="mt-1 py-3">
          {saving ? "Sending…" : "Send to Phoenix"}
        </PrimaryButton>
      </Card>
    </div>
  );
}
