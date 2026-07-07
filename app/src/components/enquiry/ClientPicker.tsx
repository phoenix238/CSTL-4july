"use client";

import { useRef, useState } from "react";
import { api, inputClass } from "../ui";

export interface ClientHit {
  id: string;
  name: string;
  clinic: string;
  email: string;
  welcomeSent: boolean;
}

/**
 * Pick an existing client without leaving the enquiry page — click to open
 * the full list (no typing needed), or type to filter it down.
 */
export function ClientPicker({ onSelect }: { onSelect: (client: ClientHit) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<ClientHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  function ensureLoaded() {
    if (all || loading) return;
    setLoading(true);
    api<{ clients: ClientHit[] }>("/api/clients?query=")
      .then((d) => setAll(d.clients))
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  }

  const q = query.trim().toLowerCase();
  const hits = (all ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));

  function pick(client: ClientHit) {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onSelect(client);
  }

  return (
    <div className="relative w-full max-w-[320px]">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true);
          ensureLoaded();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Enter" && hits[0] && pick(hits[0])}
        placeholder="…or pick an existing client"
        className={`${inputClass} text-[13px]`}
      />
      {open && (
        <div className="absolute right-0 left-0 z-40 mt-1 max-h-[280px] overflow-y-auto rounded-xl border border-line bg-card shadow-pop">
          {loading && <div className="px-3 py-2.5 text-[12.5px] text-muted">Loading…</div>}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-2.5 text-[12.5px] text-muted">
              {all && all.length === 0 ? "No clients yet" : "No matches"}
            </div>
          )}
          {hits.map((h) => (
            <button
              key={h.id}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-hoverbg"
            >
              <span className="truncate font-medium">{h.name}</span>
              <span className="flex-none text-[10.5px] text-faint capitalize">{h.clinic}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
