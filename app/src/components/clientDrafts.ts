"use client";

import { useState } from "react";

// Kept in this tab's memory while navigating. Clinical drafts are never
// written to browser storage or attached to a different client's record.
const drafts = new Map<string, string | Record<string, string>>();

export function hasClientDraft(key: string) {
  return drafts.has(key);
}

export function useClientDraft<T extends string | Record<string, string>>(key: string, initial: T) {
  const [value, setValue] = useState(() => (drafts.get(key) as T | undefined) ?? initial);

  function setDraft(next: T) {
    drafts.set(key, next);
    setValue(next);
  }

  function clearDraft(next: T) {
    drafts.delete(key);
    setValue(next);
  }

  return [value, setDraft, clearDraft] as const;
}
