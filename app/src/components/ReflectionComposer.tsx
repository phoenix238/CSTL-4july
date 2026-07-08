"use client";

import { useState } from "react";
import { api, PrimaryButton, useToast } from "./ui";

/**
 * Phoenix's own private reflections on a session — separate from the
 * client-facing session note. Saved into one shared "Phoenix session
 * reflections" Doc (dated, tagged with the client) rather than the
 * client's own Doc.
 */
export function ReflectionComposer({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) {
      toast("Nothing to save yet");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/reflection`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setText("");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-line bg-inputbg px-[18px] py-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your own reflections on this session — for you, not the client's Doc…"
        className="min-h-[110px] w-full resize-y rounded-xl border border-line bg-card px-3.5 py-3 text-sm leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
      />
      <div className="flex items-center justify-end">
        <PrimaryButton onClick={save} disabled={saving} className="px-5 py-2 text-[13px]">
          {saving ? "Saving…" : "Save to reflections doc"}
        </PrimaryButton>
      </div>
    </div>
  );
}
