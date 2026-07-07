"use client";

import { useState } from "react";
import { api, Card, PrimaryButton, inputClass, useToast } from "./ui";
import { formatDateInput } from "@/lib/time";
import { CONSENT_PARAGRAPHS, type IntakeQuestion } from "@/lib/intakeQuestions";

export function IntakeForm({
  token,
  clientName,
  clientEmail,
  clientPhone,
  alreadyDone,
  questions,
}: {
  token: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  alreadyDone: boolean;
  questions: IntakeQuestion[];
}) {
  const toast = useToast();
  const [name, setName] = useState(clientName);
  const [email, setEmail] = useState(clientEmail);
  const [answers, setAnswers] = useState<Record<string, string>>(
    questions.some((q) => q.key === "phone") ? { phone: clientPhone } : {},
  );
  const [consent, setConsent] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: string, v: string) => setAnswers((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    if (!name.trim()) {
      toast("Please add your name");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email.trim())) {
      toast("Please add a valid email address");
      return;
    }
    if (consent === null) {
      toast("Please answer the consent question");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/intake/${token}`, {
        method: "POST",
        body: JSON.stringify({ name, email, answers, consent }),
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
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink-soft">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink-soft">Email address</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <span className="text-[11.5px] leading-relaxed text-muted">
            So Phoenix can share your Google Calendar invite for the session.
          </span>
        </label>

        {questions.map((q) => (
          <label key={q.key} className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink-soft">{q.label}</span>
            {q.type === "long" ? (
              <textarea
                value={answers[q.key] ?? ""}
                onChange={(e) => set(q.key, e.target.value)}
                className={`${inputClass} min-h-[100px] resize-y leading-[1.55]`}
              />
            ) : (
              <input
                type="text"
                inputMode={q.type === "date" ? "numeric" : undefined}
                value={answers[q.key] ?? ""}
                onChange={(e) => set(q.key, q.type === "date" ? formatDateInput(e.target.value) : e.target.value)}
                placeholder={q.type === "date" ? "DD/MM/YYYY" : undefined}
                className={inputClass}
              />
            )}
          </label>
        ))}

        <div className="flex flex-col gap-2 rounded-[10px] bg-inputbg px-3.5 py-3.5">
          <span className="text-[12.5px] font-semibold text-ink-soft">Consent</span>
          {CONSENT_PARAGRAPHS.map((p, i) => (
            <p key={i} className="text-[12.5px] leading-[1.55] text-[oklch(0.4_0.02_60)]">
              {p}
            </p>
          ))}
          <div className="mt-1 flex gap-2">
            {(
              [
                [true, "Yes"],
                [false, "No"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setConsent(value)}
                className={`cursor-pointer rounded-full px-4 py-1.5 text-[12.5px] font-semibold select-none ${
                  consent === value ? "bg-clay text-cream" : "border border-line bg-card text-ink-soft"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <PrimaryButton onClick={submit} disabled={saving} className="mt-1 py-3">
          {saving ? "Sending…" : "Send to Phoenix"}
        </PrimaryButton>
      </Card>
    </div>
  );
}
