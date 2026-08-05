"use client";

import { useEffect, useState } from "react";
import { api, Card, PrimaryButton, SectionLabel, inputClass, useToast } from "./ui";

interface DocEntry {
  id: string;
  name: string;
  modifiedTime: string;
}

interface LinkStatus {
  linked: boolean;
  ok: boolean;
  docId: string;
  name: string;
  trashed?: boolean;
}

interface LinkResult {
  docId: string;
  name: string;
  url: string;
  filled: string[];
  importedHistory: boolean;
  importNote: string;
}

/**
 * Link an existing Google Doc — their case history — to this client. Search by
 * name or paste the Doc's link; nothing is copied or moved, the Doc simply
 * becomes this client's record, so every future note appends to it. Ticking
 * "bring it in" also reads the Doc once, filling anything the profile is
 * missing and showing the history here.
 */
export function LinkDocPanel({
  clientId,
  clientName,
  onLinked,
}: {
  clientId: string;
  clientName: string;
  onLinked: () => void;
}) {
  const toast = useToast();
  const [input, setInput] = useState(clientName);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [selected, setSelected] = useState<DocEntry | null>(null);
  const [importHistory, setImportHistory] = useState(true);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  const isLink = /docs\.google\.com|drive\.google\.com|\/d\//.test(input);

  // Is the Doc we think we're linked to still really there?
  useEffect(() => {
    api<LinkStatus>(`/api/clients/${clientId}/link-doc`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [clientId]);

  // Live search of your Docs while typing (skipped once it's a pasted link).
  useEffect(() => {
    if (isLink) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      const q = input.trim() ? `?q=${encodeURIComponent(input.trim())}` : "";
      api<{ docs: DocEntry[] }>(`/api/drive/docs${q}`)
        .then((d) => setDocs(d.docs))
        .catch(() => setDocs([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [input, isLink]);

  async function link(doc: string, label: string) {
    setLinking(true);
    try {
      const res = await api<LinkResult>(`/api/clients/${clientId}/link-doc`, {
        method: "POST",
        body: JSON.stringify({ doc, importHistory }),
      });
      const bits = [`Linked to "${res.name || label}" ✓`];
      if (res.filled.length) bits.push(`filled in ${res.filled.join(", ")}`);
      if (res.importedHistory) bits.push("history imported");
      if (res.importNote) bits.push(res.importNote);
      toast(bits.join(" — "));
      onLinked();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't link that Doc");
    } finally {
      setLinking(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 px-5 py-5">
      <SectionLabel>LINK A GOOGLE DOC</SectionLabel>

      {status && (
        <div className="text-[12.5px] text-muted">
          {!status.linked ? (
            <>No Doc is linked to {clientName.split(" ")[0]} yet.</>
          ) : status.ok ? (
            <>
              Currently linked to{" "}
              <a
                href={`https://docs.google.com/document/d/${status.docId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-clay-text hover:text-clay"
              >
                {status.name}
              </a>
              . Picking another one below replaces it.
            </>
          ) : (
            <span className="font-semibold text-[oklch(0.5_0.13_35)]">
              The linked Doc {status.trashed ? "is in the bin" : "can't be found any more"} — pick the right
              one below to reconnect it.
            </span>
          )}
        </div>
      )}

      <input
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setSelected(null);
        }}
        placeholder="Search your Google Docs by name, or paste a Doc link…"
        className={inputClass}
      />

      {isLink ? (
        <div className="text-[12.5px] text-muted">Pasted a link — check the tickbox below, then link it.</div>
      ) : loading ? (
        <div className="py-4 text-center text-[13px] text-muted">Looking…</div>
      ) : docs.length === 0 ? (
        <div className="py-3 text-[13px] text-muted">
          No Docs match that. Try a different name, or paste the Doc&apos;s link.
        </div>
      ) : (
        <div className="flex max-h-[300px] flex-col overflow-y-auto">
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelected(selected?.id === d.id ? null : d)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] hover:bg-hoverbg ${
                selected?.id === d.id ? "bg-clay-tint" : ""
              }`}
            >
              <span>📄</span>
              <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
              {d.id === status?.docId && <span className="flex-none text-[11.5px] text-muted">linked now</span>}
              <span className="flex-none text-[11.5px] text-faint">
                {d.modifiedTime ? new Date(d.modifiedTime).toLocaleDateString("en-GB") : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-muted">
        <input
          type="checkbox"
          checked={importHistory}
          onChange={(e) => setImportHistory(e.target.checked)}
          className="mt-[3px]"
        />
        <span>
          Bring what&apos;s already in it into this profile — fills in any details still missing (nothing on
          file is overwritten) and shows the case history here.
        </span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-faint">
          The Doc stays where it is in Drive — nothing is copied or moved.
        </div>
        <PrimaryButton
          onClick={() => (isLink ? link(input.trim(), "that Doc") : selected && link(selected.id, selected.name))}
          disabled={linking || (!isLink && !selected)}
          className="flex-none px-4 py-2 text-[12.5px]"
        >
          {linking ? "Linking…" : "Link this Doc"}
        </PrimaryButton>
      </div>
    </Card>
  );
}
