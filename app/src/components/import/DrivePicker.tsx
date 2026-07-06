"use client";

import { useEffect, useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, inputClass, useToast } from "../ui";

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

function fileIcon(mime: string) {
  if (mime === "application/vnd.google-apps.document") return "📄";
  if (mime === "application/vnd.google-apps.spreadsheet") return "📊";
  if (mime.includes("pdf")) return "📕";
  if (mime.includes("word") || mime.includes("officedocument")) return "📝";
  return "📎";
}

/**
 * Pick files straight from Google Drive: paste a folder link, search folders
 * by name, or browse from the top. Nothing is read until "Analyse".
 */
export function DrivePicker({
  onAnalyse,
  analysing,
}: {
  onAnalyse: (files: DriveEntry[]) => void;
  analysing: boolean;
}) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [folders, setFolders] = useState<DriveEntry[]>([]);
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [files, setFiles] = useState<DriveEntry[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const isLink = /drive\.google\.com|\/folders\//.test(input);

  // Browse root on mount; live folder search while typing (unless it's a link).
  useEffect(() => {
    if (isLink) return;
    const t = setTimeout(() => {
      const q = input.trim() ? `?q=${encodeURIComponent(input.trim())}` : "";
      api<{ folders: DriveEntry[] }>(`/api/import/drive/folders${q}`)
        .then((d) => setFolders(d.folders))
        .catch(() => setFolders([]));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isLink]);

  async function openFolder(id: string, name: string, fromTrailIndex?: number) {
    setLoading(true);
    try {
      const [d, sub] = await Promise.all([
        api<{ files: DriveEntry[] }>(`/api/import/drive/list?folderId=${encodeURIComponent(id)}`),
        api<{ folders: DriveEntry[] }>(`/api/import/drive/folders?parent=${encodeURIComponent(id)}`),
      ]);
      setFiles(d.files);
      setFolders(sub.folders);
      setChecked(new Set(d.files.map((f) => f.id))); // select all by default
      setTrail((t) => (fromTrailIndex !== undefined ? t.slice(0, fromTrailIndex + 1) : [...t, { id, name }]));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't open that folder");
    } finally {
      setLoading(false);
    }
  }

  async function openLink() {
    setLoading(true);
    try {
      const d = await api<{ files: DriveEntry[]; folderId: string }>(
        `/api/import/drive/list?folderId=${encodeURIComponent(input.trim())}`,
      );
      setFiles(d.files);
      setFolders([]);
      setChecked(new Set(d.files.map((f) => f.id)));
      setTrail([{ id: d.folderId, name: "Linked folder" }]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't open that link");
    } finally {
      setLoading(false);
    }
  }

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selected = (files ?? []).filter((f) => checked.has(f.id));

  return (
    <Card className="flex flex-col gap-3 px-5 py-5">
      <SectionLabel>FROM GOOGLE DRIVE</SectionLabel>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && isLink && openLink()}
          placeholder="Paste a Drive folder link, or type to search your folders…"
          className={inputClass}
        />
        {isLink && (
          <PrimaryButton onClick={openLink} disabled={loading} className="flex-none px-4 py-2 text-[12.5px]">
            Open
          </PrimaryButton>
        )}
      </div>

      {trail.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
          <button
            onClick={() => {
              setTrail([]);
              setFiles(null);
              setInput("");
            }}
            className="cursor-pointer font-semibold hover:text-ink"
          >
            Drive
          </button>
          {trail.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1">
              <span>›</span>
              <button
                onClick={() => openFolder(t.id, t.name, i)}
                className={`cursor-pointer hover:text-ink ${i === trail.length - 1 ? "font-semibold text-ink" : ""}`}
              >
                {t.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-[13px] text-muted">Loading…</div>
      ) : (
        <>
          {folders.length > 0 && (
            <div className="flex flex-col">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openFolder(f.id, f.name)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] hover:bg-hoverbg"
                >
                  <span>📁</span>
                  <span className="font-medium">{f.name}</span>
                </button>
              ))}
            </div>
          )}

          {files && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <SectionLabel>
                  {files.length} FILE{files.length === 1 ? "" : "S"}
                </SectionLabel>
                {files.length > 0 && (
                  <button
                    onClick={() =>
                      setChecked(checked.size === files.length ? new Set() : new Set(files.map((f) => f.id)))
                    }
                    className="cursor-pointer text-[12px] font-semibold text-clay-text hover:text-clay"
                  >
                    {checked.size === files.length ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              {files.length === 0 && (
                <div className="py-3 text-[13px] text-muted">No files in this folder — open a subfolder above.</div>
              )}
              {files.map((f) => (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-hoverbg"
                >
                  <input type="checkbox" checked={checked.has(f.id)} onChange={() => toggle(f.id)} />
                  <span>{fileIcon(f.mimeType)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="flex-none text-[11.5px] text-faint">
                    {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString("en-GB") : ""}
                  </span>
                </label>
              ))}
              {selected.length > 0 && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-[12.5px] text-muted">
                    Files are <b>copied</b> into each client&apos;s folder — your originals stay where they are.
                  </div>
                  <OutlineButton onClick={() => onAnalyse(selected)} disabled={analysing}>
                    {analysing ? "Reading…" : `Analyse ${selected.length} file${selected.length === 1 ? "" : "s"}`}
                  </OutlineButton>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
