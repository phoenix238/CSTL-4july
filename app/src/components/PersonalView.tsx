"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, inputClass, useToast } from "./ui";
import { useLiveTranscript } from "./useLiveTranscript";

interface Reflection {
  id: string;
  dateISO: string;
  clientId: string | null;
  clientName: string;
  text: string;
}

interface ClientOption {
  id: string;
  name: string;
}

type Filter = { kind: "all" } | { kind: "none" } | { kind: "client"; id: string; name: string };

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Type-ahead client picker, for tagging a reflection or filtering by one. */
function ClientPick({ onPick, placeholder }: { onPick: (c: ClientOption) => void; placeholder: string }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientOption[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ clients: ClientOption[] }>(`/api/clients?query=${encodeURIComponent(query.trim())}`)
        .then((d) => setHits(d.clients))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="relative w-[210px]">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} py-1.5 text-[12.5px]`}
      />
      {hits.length > 0 && (
        <div className="absolute right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg border border-line bg-card shadow-pop">
          {hits.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                onPick(h);
                setQuery("");
                setHits([]);
              }}
              className="block w-full cursor-pointer px-3 py-2 text-left text-[12.5px] font-medium hover:bg-hoverbg"
            >
              {h.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Phoenix's own space. Reflections on a session go here tagged with the client;
 * so does anything she just wants to think through, tagged with nobody — which
 * is the bit that had nowhere to live before.
 *
 * Everything is also appended to the "Phoenix session reflections" Doc in
 * Drive, linked at the top. The app is where they're read back and searched;
 * the Doc is the copy that outlives the app.
 */
export function PersonalView({ reflectionsDocId }: { reflectionsDocId: string | null }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [about, setAbout] = useState<ClientOption | null>(null);
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<Reflection[] | null>(null);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [query, setQuery] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const baseRef = useRef("");
  const finalRef = useRef("");
  const { listening, start, stop } = useLiveTranscript({
    onFinal: (chunk) => {
      finalRef.current += chunk + " ";
      setText(baseRef.current + finalRef.current);
    },
    onInterim: (interim) => setText(baseRef.current + finalRef.current + interim),
    onUnsupported: () => toast("Voice dictation needs Chrome or Safari — you can still type"),
    onBlocked: () => toast("Microphone blocked — allow it in your browser settings"),
  });

  const toggleMic = () => {
    if (listening) {
      stop();
      return;
    }
    baseRef.current = text ? text.replace(/\s+$/, "") + " " : "";
    finalRef.current = "";
    start();
  };

  const params = useCallback(
    (before?: string) => {
      const p = new URLSearchParams();
      if (filter.kind === "none") p.set("client", "none");
      if (filter.kind === "client") p.set("client", filter.id);
      if (before) p.set("before", before);
      const s = p.toString();
      return s ? `?${s}` : "";
    },
    [filter],
  );

  const load = useCallback(() => {
    setItems(null);
    api<{ reflections: Reflection[]; more: boolean }>(`/api/reflections${params()}`)
      .then((d) => {
        setItems(d.reflections);
        setMore(d.more);
      })
      .catch((err) => {
        toast(err instanceof Error ? err.message : "Couldn't load your reflections");
        setItems([]);
      });
  }, [params, toast]);

  useEffect(load, [load]);

  const loadOlder = async () => {
    const last = items?.at(-1);
    if (!last) return;
    try {
      const d = await api<{ reflections: Reflection[]; more: boolean }>(
        `/api/reflections${params(last.dateISO)}`,
      );
      setItems((current) => [...(current ?? []), ...d.reflections]);
      setMore(d.more);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load more");
    }
  };

  const save = async () => {
    if (!text.trim()) {
      toast("Nothing to save yet");
      return;
    }
    stop();
    setSaving(true);
    try {
      const { reflection, docError } = await api<{ reflection: Reflection; docError: string }>(
        "/api/reflections",
        { method: "POST", body: JSON.stringify({ text, clientId: about?.id ?? null }) },
      );
      setText("");
      setAbout(null);
      // Only show it straight away when the current filter would include it.
      const visible =
        filter.kind === "all" ||
        (filter.kind === "none" && !reflection.clientId) ||
        (filter.kind === "client" && filter.id === reflection.clientId);
      if (visible) setItems((current) => [reflection, ...(current ?? [])]);
      toast(docError ? `Saved — but not to Drive (${docError})` : "Saved ✓");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    try {
      await api(`/api/reflections/${id}`, { method: "PATCH", body: JSON.stringify({ text: editText }) });
      setItems((current) => (current ?? []).map((r) => (r.id === id ? { ...r, text: editText.trim() } : r)));
      setEditingId(null);
      toast("Updated ✓ — the Drive doc keeps the original");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const remove = async (r: Reflection) => {
    if (!confirm("Delete this reflection from the app? It stays in your Drive doc.")) return;
    try {
      await api(`/api/reflections/${r.id}`, { method: "DELETE" });
      setItems((current) => (current ?? []).filter((x) => x.id !== r.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete");
    }
  };

  const shown = (items ?? []).filter((r) =>
    query.trim()
      ? `${r.text} ${r.clientName}`.toLowerCase().includes(query.trim().toLowerCase())
      : true,
  );

  const tab = (label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1 text-[12.5px] font-semibold ${
        active ? "bg-clay-tint text-clay-text" : "text-muted hover:bg-hoverbg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[22px] leading-tight">Personal</h1>
          <p className="mt-1 max-w-[58ch] text-[13px] leading-[1.55] text-ink-soft">
            Your own writing — reflections on a session, or just thinking. Nothing here goes into a
            client&apos;s record.
          </p>
        </div>
        {reflectionsDocId && (
          <a
            href={`https://docs.google.com/document/d/${reflectionsDocId}/edit`}
            target="_blank"
            rel="noreferrer"
            className="text-[12.5px] font-semibold text-clay-text hover:underline"
          >
            Open the Drive doc ›
          </a>
        )}
      </div>

      <Card className="p-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's on your mind…"
          className="min-h-[120px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-sm leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={toggleMic}
            className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold ${
              listening ? "bg-[oklch(0.45_0.13_30)] text-cream" : "bg-clay-tint text-clay-text"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${listening ? "animate-ct-pulse bg-[oklch(0.9_0.05_30)]" : "bg-clay-text"}`}
            />
            {listening ? "Listening…" : "Dictate"}
          </button>

          {about ? (
            <span className="flex items-center gap-1.5 rounded-full bg-clay-tint px-3 py-1.5 text-[12.5px] font-semibold text-clay-text">
              About {about.name}
              <button onClick={() => setAbout(null)} className="cursor-pointer text-clay-text/60 hover:text-clay-text">
                ✕
              </button>
            </span>
          ) : (
            <ClientPick onPick={setAbout} placeholder="About a client? (optional)" />
          )}

          <div className="flex-1" />
          <PrimaryButton onClick={save} disabled={saving} className="px-5 py-2 text-[13px]">
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2 px-0.5">
        <SectionLabel className="mr-1">REFLECTIONS</SectionLabel>
        {tab("All", filter.kind === "all", () => setFilter({ kind: "all" }))}
        {tab("Just me", filter.kind === "none", () => setFilter({ kind: "none" }))}
        {filter.kind === "client" ? (
          <button
            onClick={() => setFilter({ kind: "all" })}
            className="cursor-pointer rounded-full bg-clay-tint px-3 py-1 text-[12.5px] font-semibold text-clay-text"
          >
            {filter.name} ✕
          </button>
        ) : (
          <ClientPick
            onPick={(c) => setFilter({ kind: "client", id: c.id, name: c.name })}
            placeholder="By client…"
          />
        )}
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what you've written…"
          className={`${inputClass} w-[220px] py-1.5 text-[12.5px]`}
        />
      </div>

      {items === null ? (
        <div className="px-1 text-[13px] text-muted">Loading…</div>
      ) : !shown.length ? (
        <Card className="p-6 text-center text-[13px] text-muted">
          {query.trim()
            ? "Nothing matches that."
            : filter.kind === "all"
              ? "Nothing written yet. The box above is the place."
              : "Nothing here yet."}
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-ink-soft">{fmtWhen(r.dateISO)}</span>
                {r.clientId ? (
                  <Link
                    href={`/clients/${r.clientId}`}
                    className="rounded-full bg-clay-tint px-2.5 py-[3px] text-[11.5px] font-medium text-clay-text hover:underline"
                  >
                    {r.clientName}
                  </Link>
                ) : (
                  <span className="rounded-full bg-inputbg px-2.5 py-[3px] text-[11.5px] font-medium text-muted">
                    {r.clientName ? `${r.clientName} — since deleted` : "Just me"}
                  </span>
                )}
                <div className="flex-1" />
                {editingId === r.id ? (
                  <button
                    onClick={() => setEditingId(null)}
                    className="cursor-pointer text-[11.5px] font-semibold text-muted hover:text-ink-soft"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(r.id);
                      setEditText(r.text);
                    }}
                    className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => remove(r)}
                  className="cursor-pointer text-[11.5px] font-semibold text-faint hover:text-[oklch(0.55_0.15_25)]"
                >
                  Delete
                </button>
              </div>

              {editingId === r.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="min-h-[100px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-[13.5px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
                  />
                  <div className="flex justify-end">
                    <PrimaryButton onClick={() => saveEdit(r.id)} className="px-4 py-1.5 text-[12.5px]">
                      Save
                    </PrimaryButton>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-[13.5px] leading-[1.6] whitespace-pre-line text-ink">{r.text}</p>
              )}
            </Card>
          ))}

          {more && !query.trim() && (
            <div className="flex justify-center pt-1">
              <OutlineButton onClick={loadOlder}>Load older</OutlineButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
