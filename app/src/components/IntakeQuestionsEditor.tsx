"use client";

import { useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, inputClass, useToast } from "./ui";
import { COLUMN_KEYS, type IntakeQuestion } from "@/lib/intakeQuestions";

let customCounter = 0;

export function IntakeQuestionsEditor({ initial }: { initial: IntakeQuestion[] }) {
  const toast = useToast();
  const [questions, setQuestions] = useState<IntakeQuestion[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<IntakeQuestion>) => {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  const remove = (i: number) => {
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    setQuestions((qs) => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  const addCustom = () => {
    setQuestions((qs) => [
      ...qs,
      { key: `custom_${Date.now()}_${customCounter++}`, label: "New question", type: "short", enabled: true, custom: true },
    ]);
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ intakeQuestions: questions }) });
      toast("Intake questions saved ✓");
      setDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2 px-4 py-4">
      {questions.map((q, i) => (
        <div key={q.key} className="flex flex-wrap items-center gap-2 border-b border-hairline py-2 last:border-0">
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="cursor-pointer text-[10px] leading-none text-muted hover:text-ink disabled:opacity-30"
              aria-label="Move up"
            >
              ▲
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === questions.length - 1}
              className="cursor-pointer text-[10px] leading-none text-muted hover:text-ink disabled:opacity-30"
              aria-label="Move down"
            >
              ▼
            </button>
          </div>
          <input
            value={q.label}
            onChange={(e) => update(i, { label: e.target.value })}
            className={`${inputClass} min-w-[180px] flex-1`}
          />
          <select
            value={q.type}
            onChange={(e) => update(i, { type: e.target.value as IntakeQuestion["type"] })}
            className="cursor-pointer rounded-lg border border-inputline bg-inputbg px-2 py-2 text-[12.5px]"
          >
            <option value="short">Short</option>
            <option value="long">Long</option>
            <option value="date">Date</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={q.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
            Show
          </label>
          {!COLUMN_KEYS.has(q.key) && q.key !== "caseHistory" ? (
            <button
              onClick={() => remove(i)}
              className="cursor-pointer text-[12px] font-semibold text-muted hover:text-[oklch(0.55_0.15_25)]"
            >
              Remove
            </button>
          ) : (
            <span className="text-[10.5px] text-faint" title="Standard question — fills the client record">
              standard
            </span>
          )}
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <OutlineButton onClick={addCustom} className="px-3.5 py-1.5 text-[12.5px]">
          + Add a question
        </OutlineButton>
        <PrimaryButton onClick={save} disabled={!dirty || saving} className="px-4 py-1.5 text-[12.5px]">
          {saving ? "Saving…" : "Save questions"}
        </PrimaryButton>
      </div>
      <div className="text-[11.5px] text-muted">
        &quot;Standard&quot; questions fill the client&apos;s record (DOB, meds, etc.). Questions you add are saved
        into the client&apos;s Doc. Untick <b>Show</b> to hide one without deleting it.
      </div>
    </Card>
  );
}
