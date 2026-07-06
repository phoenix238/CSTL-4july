"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, inputClass } from "./ui";

interface Hit {
  id: string;
  name: string;
  clinic: string;
}

/** Find any client from anywhere — Cmd/Ctrl-K or / focuses it. */
export function ClientSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !inField)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") inputRef.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ clients: Hit[] }>(`/api/clients?query=${encodeURIComponent(query.trim())}`)
        .then((d) => setHits(d.clients))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function open(id: string) {
    setQuery("");
    setHits([]);
    inputRef.current?.blur();
    onNavigate?.();
    router.push(`/clients/${id}`);
  }

  return (
    <div className="relative px-1 pb-3">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => e.key === "Enter" && hits[0] && open(hits[0].id)}
        placeholder="Find a client…  ⌘K"
        className={`${inputClass} py-1.5 text-[12.5px]`}
      />
      {focused && hits.length > 0 && (
        <div className="absolute right-1 left-1 z-40 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
          {hits.map((h) => (
            <button
              key={h.id}
              onMouseDown={(e) => {
                e.preventDefault();
                open(h.id);
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
