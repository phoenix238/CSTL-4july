"use client";

import { useEffect, useRef, useState } from "react";
import { api, inputClass } from "../ui";

export interface ClientHit {
  id: string;
  name: string;
  clinic: string;
  email: string;
  welcomeSent: boolean;
}

/** Pick an existing client without leaving the enquiry page — unlike ClientSearch, selecting doesn't navigate. */
export function ClientPicker({ onSelect }: { onSelect: (client: ClientHit) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ clients: ClientHit[] }>(`/api/clients?query=${encodeURIComponent(query.trim())}`)
        .then((d) => setHits(d.clients))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function pick(client: ClientHit) {
    setQuery("");
    setHits([]);
    inputRef.current?.blur();
    onSelect(client);
  }

  return (
    <div className="relative w-full max-w-[320px]">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => e.key === "Enter" && hits[0] && pick(hits[0])}
        placeholder="…or pick an existing client"
        className={`${inputClass} text-[13px]`}
      />
      {focused && hits.length > 0 && (
        <div className="absolute right-0 left-0 z-40 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
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
