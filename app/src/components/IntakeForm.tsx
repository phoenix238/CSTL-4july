"use client";

import { useState } from "react";
import { api, Card, PrimaryButton, inputClass, useToast } from "./ui";
import type { IntakeQuestion } from "@/lib/intakeQuestions";

export function IntakeForm({
  token,
  clientName,
  clientPhone,
  alreadyDone,
  questions,
}: {
  token: string;
  clientName: string;
  clientPhone: string;
  alreadyDone: boolean;
  questions: IntakeQuestion[];
}) {
  const toast = useToast();
  const [name, setName] = useState(clientName);
  const [answers, setAnswers] = useState<Record<string, string>>(
    questions.some((q) => q.key === "phone") ? { phone: clientPhone } : {},
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k: string, v: string) => setAnswers((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    if (!name.trim()) {
      toast("Please add your name");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/intake/${token}`, {
        method: "POST",
        body: JSON.stringify({ name, answers }),
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
                type={q.type === "date" ? "text" : "text"}
                value={answers[q.key] ?? ""}
                onChange={(e) => set(q.key, e.target.value)}
                placeholder={q.type === "date" ? "e.g. 14/03/1990" : undefined}
                className={inputClass}
              />
            )}
          </label>
        ))}

        <PrimaryButton onClick={submit} disabled={saving} className="mt-1 py-3">
          {saving ? "Sending…" : "Send to Phoenix"}
        </PrimaryButton>
      </Card>
    </div>
  );
}
