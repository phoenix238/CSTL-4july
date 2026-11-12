"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api, Card, inputClass, PrimaryButton, TintButton, useToast } from "./ui";

type Note = { id: string; text: string; done: boolean };

export function ImprovementNotes({ notes }: { notes: Note[] }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const busy = saving || refreshing;

  async function save(note?: Note) {
    setSaving(true);
    try {
      await api("/api/improvements", {
        method: note ? "PATCH" : "POST",
        body: JSON.stringify(note ? { id: note.id, done: !note.done } : { text }),
      });
      if (!note) setText("");
      startTransition(() => router.refresh());
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the improvement note.");
    } finally {
      setSaving(false);
    }
  }

  function row(note: Note) {
    return (
      <Card key={note.id} className="flex items-start justify-between gap-3 p-4">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm">{note.text}</p>
        <TintButton disabled={busy} onClick={() => save(note)} className="shrink-0">
          {note.done ? "Reopen" : "Mark done"}
        </TintButton>
      </Card>
    );
  }

  const open = notes.filter((note) => !note.done);
  const done = notes.filter((note) => note.done);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h1 className="font-serif text-2xl">App improvements</h1>
      <Card className="p-4">
        <form className="flex flex-col items-start gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (!busy && text.trim()) void save();
        }}>
          <label className="flex w-full flex-col gap-2 text-sm font-semibold">
            What would you like to change?
            <textarea className={inputClass} value={text} onChange={(event) => setText(event.target.value)}
              rows={4} maxLength={4000} disabled={busy} required />
          </label>
          <PrimaryButton type="submit" disabled={busy || !text.trim()}>{saving ? "Saving…" : "Save idea"}</PrimaryButton>
        </form>
      </Card>
      {open.map(row)}
      {done.length > 0 && (
        <details className="space-y-2 text-sm">
          <summary className="cursor-pointer font-semibold">Done ({done.length})</summary>
          {done.map(row)}
        </details>
      )}
    </div>
  );
}
