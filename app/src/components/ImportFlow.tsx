"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, inputClass, useToast } from "./ui";
import { DrivePicker, type DriveEntry } from "./import/DrivePicker";

interface Proposal {
  file: string;
  driveFileId?: string;
  client: {
    name: string;
    email: string;
    phone: string;
    dob: string;
    occupation: string;
    doctor: string;
    meds: string;
    conditions: string;
    emergency: string;
    referred: string;
    marketing: boolean;
    notes: string;
  };
  mergeWithId: string | null;
  mergeWithName: string | null;
  found: string;
}

interface Unreadable {
  name: string;
  driveFileId?: string;
  /** client the therapist matched it to by hand */
  matchId?: string;
  matchName?: string;
}

type Stage = "empty" | "analysing" | "review" | "running" | "done";
type Mode = "upload" | "drive";

/** Search-as-you-type client matcher for files that couldn't be auto-read. */
function MatchClientInput({ onPick }: { onPick: (c: { id: string; name: string }) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ clients: Array<{ id: string; name: string }> }>(`/api/clients?query=${encodeURIComponent(query.trim())}`)
        .then((d) => setHits(d.clients))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="relative w-[200px]">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Match to a client…"
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

export function ImportFlow() {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("upload");
  const [stage, setStage] = useState<Stage>("empty");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [unreadable, setUnreadable] = useState<Unreadable[]>([]);
  const [summary, setSummary] = useState({ created: 0, merged: 0, stored: 0 });
  const filesRef = useRef<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const applyResults = (res: { proposals: Proposal[]; unreadable: Array<{ name: string; driveFileId?: string }> }) => {
    setProposals(res.proposals);
    setUnreadable(res.unreadable);
    if (!res.proposals.length && !res.unreadable.length) {
      toast("No client details found in those files");
      setStage("empty");
    } else setStage("review");
  };

  const analyseUploads = async (files: File[]) => {
    if (!files.length) return;
    filesRef.current = files;
    setStage("analysing");
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      applyResults(await api("/api/import/analyse", { method: "POST", body: form }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read the files");
      setStage("empty");
    }
  };

  const analyseDrive = async (files: DriveEntry[]) => {
    filesRef.current = [];
    setStage("analysing");
    try {
      applyResults(
        await api("/api/import/drive/analyse", {
          method: "POST",
          body: JSON.stringify({ files: files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType })) }),
        }),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read those Drive files");
      setStage("empty");
    }
  };

  const run = async () => {
    setStage("running");
    try {
      const plan = [
        ...proposals.map((p) => ({
          file: p.file,
          mergeWithId: p.mergeWithId,
          client: p.client,
          driveFileId: p.driveFileId,
        })),
        ...unreadable
          .filter((u) => u.matchId)
          .map((u) => ({
            file: u.name,
            mergeWithId: u.matchId!,
            driveFileId: u.driveFileId,
            storeOnly: true,
          })),
      ];
      const form = new FormData();
      form.append("plan", JSON.stringify(plan));
      for (const f of filesRef.current) form.append("files", f);
      const res = await api<{ created: number; merged: number; stored: number }>("/api/import/run", {
        method: "POST",
        body: form,
      });
      setSummary(res);
      setStage("done");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed");
      setStage("review");
    }
  };

  const marketingCount = proposals.filter((p) => p.client.marketing).length;
  const mergeCount = proposals.filter((p) => p.mergeWithId).length;
  const newCount = proposals.length - mergeCount;
  const matchedCount = unreadable.filter((u) => u.matchId).length;
  const anyDrive = proposals.some((p) => p.driveFileId) || unreadable.some((u) => u.driveFileId);

  return (
    <div className="flex max-w-[900px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header>
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Import existing clients</h1>
        <div className="mt-[5px] text-[13.5px] text-muted">
          Bring your old files in — each client ends up with one record, one Drive folder, one Doc.
        </div>
      </header>

      {stage === "empty" && (
        <>
          <div className="flex self-start rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
            {(
              [
                ["upload", "Upload files"],
                ["drive", "From Google Drive"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`cursor-pointer rounded-full px-4 py-[7px] text-[12.5px] font-semibold select-none ${
                  mode === m ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "upload" ? (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                analyseUploads(Array.from(e.dataTransfer.files));
              }}
              className={`cursor-pointer rounded-[20px] border-[1.5px] border-dashed p-[60px_30px] text-center ${
                dragOver
                  ? "border-clay/60 bg-[oklch(0.975_0.015_70)]"
                  : "border-[oklch(0.83_0.03_60)] bg-cream hover:border-clay/60 hover:bg-[oklch(0.975_0.015_70)]"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => analyseUploads(Array.from(e.target.files ?? []))}
              />
              <div className="mx-auto mb-3.5 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-clay-tint text-[22px] text-clay-text">
                ↑
              </div>
              <div className="font-serif text-[19px] font-medium">Drop client files here, or click to choose</div>
              <div className="mt-1.5 text-[13px] text-muted">
                TXT · CSV · DOCX · PDF read automatically — anything else is stored in the client&apos;s folder
                as-is. Nothing is written to Drive until you review.
              </div>
            </div>
          ) : (
            <DrivePicker onAnalyse={analyseDrive} analysing={false} />
          )}
        </>
      )}

      {stage === "analysing" && (
        <div className="flex h-[220px] items-center justify-center rounded-[20px] border border-line bg-card text-[13.5px] text-muted">
          Reading files &amp; picking out client details…
        </div>
      )}

      {(stage === "review" || stage === "running") && (
        <div className="flex flex-col gap-2.5">
          <SectionLabel>
            REVIEW — {proposals.length} CLIENT{proposals.length === 1 ? "" : "S"} DETECTED
            {unreadable.length > 0 ? ` · ${unreadable.length} UNREADABLE` : ""}
          </SectionLabel>
          <Card className="px-4 py-0.5 lg:px-[18px]">
            {proposals.map((p, i) => (
              <div
                key={`${p.file}-${p.client.name}`}
                className={`flex flex-wrap items-center gap-2 py-3 lg:gap-3.5 ${i < proposals.length - 1 ? "border-b border-hairline" : ""}`}
              >
                <div className="w-full flex-none overflow-hidden font-mono text-[12.5px] font-medium text-ellipsis whitespace-nowrap text-[oklch(0.45_0.02_60)] sm:w-[230px]">
                  {p.file}
                </div>
                <div className="hidden text-[oklch(0.62_0.03_55)] sm:block">→</div>
                <div className="min-w-0 flex-1 text-[13.5px] font-semibold">
                  {p.client.name}
                  {p.mergeWithId && p.mergeWithName && (
                    <Link
                      href={`/clients/${p.mergeWithId}`}
                      className="ml-1 font-normal text-muted underline-offset-2 hover:text-clay-text hover:underline"
                    >
                      {p.mergeWithName === p.client.name ? "open ›" : `(= ${p.mergeWithName})`}
                    </Link>
                  )}
                </div>
                <div className="text-xs text-muted">{p.found}</div>
                <span
                  className="flex-none rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
                  style={
                    p.mergeWithId
                      ? { color: "oklch(0.42 0.08 148)", background: "oklch(0.94 0.03 148)" }
                      : { color: "oklch(0.42 0.1 42)", background: "oklch(0.94 0.03 48)" }
                  }
                >
                  {p.mergeWithId ? "Merge" : "New client"}
                </span>
              </div>
            ))}
            {unreadable.map((f, ui) => (
              <div key={f.name} className="flex flex-wrap items-center gap-3 border-t border-hairline py-3">
                <div className="w-[230px] flex-none overflow-hidden font-mono text-[12.5px] text-ellipsis whitespace-nowrap text-[oklch(0.45_0.02_60)]">
                  {f.name}
                </div>
                <div className="min-w-[180px] flex-1 text-xs text-muted">
                  Can&apos;t auto-read this format (old .doc? scanned?) — match it to a client and it&apos;ll be
                  stored in their folder.
                </div>
                {f.matchId ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-sage-text">
                    → {f.matchName}
                    <button
                      onClick={() =>
                        setUnreadable((u) =>
                          u.map((x, i) => (i === ui ? { ...x, matchId: undefined, matchName: undefined } : x)),
                        )
                      }
                      className="cursor-pointer text-[11.5px] font-normal text-muted underline hover:text-ink"
                    >
                      change
                    </button>
                  </span>
                ) : (
                  <MatchClientInput
                    onPick={(c) =>
                      setUnreadable((u) =>
                        u.map((x, i) => (i === ui ? { ...x, matchId: c.id, matchName: c.name } : x)),
                      )
                    }
                  />
                )}
              </div>
            ))}
          </Card>
          <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-[oklch(0.85_0.05_148_/_0.5)] bg-[oklch(0.94_0.03_148_/_0.45)] px-[18px] py-3.5">
            <div className="min-w-[200px] flex-1 text-[13px] leading-[1.55] text-[oklch(0.35_0.04_148)]">
              Will create <b>{newCount} folder{newCount === 1 ? "" : "s"} + Doc{newCount === 1 ? "" : "s"}</b> in
              Drive › CSTL › Clients, merge {mergeCount} duplicate{mergeCount === 1 ? "" : "s"}
              {matchedCount > 0 ? `, store ${matchedCount} matched file${matchedCount === 1 ? "" : "s"}` : ""}, and
              update {proposals.length} row{proposals.length === 1 ? "" : "s"} on the marketing sheet (
              {marketingCount} consented).
              {anyDrive && " Drive files are copied — your originals stay where they are."}
            </div>
            <OutlineButton onClick={() => setStage("empty")} disabled={stage === "running"}>
              Cancel
            </OutlineButton>
            <PrimaryButton onClick={run} disabled={stage === "running"} className="px-[18px] py-[9px] text-[13px]">
              {stage === "running" ? "Importing…" : "Import all"}
            </PrimaryButton>
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className="flex justify-center pt-5">
          <div className="w-full max-w-[480px] rounded-[20px] border border-line bg-card px-[34px] py-8 text-center shadow-card">
            <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
              ✓
            </div>
            <div className="mt-3.5 font-serif text-2xl font-medium">
              {summary.created + summary.merged} client{summary.created + summary.merged === 1 ? "" : "s"} imported
            </div>
            <div className="mt-[18px] mb-1 flex flex-col gap-2 text-left">
              <div className="flex gap-2 text-[13px] text-[oklch(0.42_0.02_60)]">
                <span className="text-sage-text">✓</span>
                <span>
                  {summary.created} Doc{summary.created === 1 ? "" : "s"} created in Drive › CSTL › Clients › (client
                  name)
                </span>
              </div>
              <div className="flex gap-2 text-[13px] text-[oklch(0.42_0.02_60)]">
                <span className="text-sage-text">✓</span>
                <span>Old notes appended to each Doc — copies stored in each client&apos;s folder, originals stay put</span>
              </div>
              <div className="flex gap-2 text-[13px] text-[oklch(0.42_0.02_60)]">
                <span className="text-sage-text">✓</span>
                <span>Marketing sheet updated</span>
              </div>
              <div className="flex gap-2 text-[13px] text-[oklch(0.42_0.02_60)]">
                <span className="text-sage-text">✓</span>
                <span>
                  {summary.merged} duplicate{summary.merged === 1 ? "" : "s"} merged
                  {summary.stored > 0 ? ` · ${summary.stored} matched file${summary.stored === 1 ? "" : "s"} stored` : ""}{" "}
                  — still one record each
                </span>
              </div>
            </div>
            <PrimaryButton onClick={() => router.push("/clients")} className="mt-5">
              View clients
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
