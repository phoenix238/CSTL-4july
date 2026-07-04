"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, useToast } from "./ui";

interface Proposal {
  file: string;
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

type Stage = "empty" | "analysing" | "review" | "running" | "done";

export function ImportFlow() {
  const router = useRouter();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>("empty");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [summary, setSummary] = useState({ created: 0, merged: 0 });
  const filesRef = useRef<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const analyse = async (files: File[]) => {
    if (!files.length) return;
    filesRef.current = files;
    setStage("analysing");
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await api<{ proposals: Proposal[]; unreadable: string[] }>("/api/import/analyse", {
        method: "POST",
        body: form,
      });
      setProposals(res.proposals);
      setUnreadable(res.unreadable);
      if (!res.proposals.length && !res.unreadable.length) {
        toast("No client details found in those files");
        setStage("empty");
      } else setStage("review");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read the files");
      setStage("empty");
    }
  };

  const run = async () => {
    setStage("running");
    try {
      const form = new FormData();
      form.append(
        "plan",
        JSON.stringify(proposals.map((p) => ({ file: p.file, mergeWithId: p.mergeWithId, client: p.client }))),
      );
      for (const f of filesRef.current) form.append("files", f);
      const res = await api<{ created: number; merged: number }>("/api/import/run", {
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

  return (
    <div className="flex max-w-[900px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header>
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Import existing clients</h1>
        <div className="mt-[5px] text-[13.5px] text-muted">
          Bring your old files in — each client ends up with one record, one Drive folder, one Doc.
        </div>
      </header>

      {stage === "empty" && (
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
            analyse(Array.from(e.dataTransfer.files));
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
            onChange={(e) => analyse(Array.from(e.target.files ?? []))}
          />
          <div className="mx-auto mb-3.5 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-clay-tint text-[22px] text-clay-text">
            ↑
          </div>
          <div className="font-serif text-[19px] font-medium">Drop client files here, or click to choose</div>
          <div className="mt-1.5 text-[13px] text-muted">
            TXT · CSV read automatically — PDF/DOCX are stored in the client&apos;s folder as-is. Nothing is written
            to Drive until you review.
          </div>
        </div>
      )}

      {stage === "analysing" && (
        <div className="flex h-[220px] items-center justify-center rounded-[20px] border border-line bg-card text-[13.5px] text-muted">
          Reading files &amp; picking out client details…
        </div>
      )}

      {(stage === "review" || stage === "running") && (
        <div className="flex flex-col gap-2.5">
          <SectionLabel>
            REVIEW — {filesRef.current.length} FILE{filesRef.current.length === 1 ? "" : "S"} ·{" "}
            {proposals.length} CLIENT{proposals.length === 1 ? "" : "S"} DETECTED
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
                  {p.mergeWithName && p.mergeWithName !== p.client.name && (
                    <span className="ml-1 font-normal text-muted">(= {p.mergeWithName})</span>
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
            {unreadable.map((f) => (
              <div key={f} className="flex items-center gap-3.5 border-t border-hairline py-3">
                <div className="w-[230px] flex-none overflow-hidden font-mono text-[12.5px] text-ellipsis whitespace-nowrap text-[oklch(0.45_0.02_60)]">
                  {f}
                </div>
                <div className="flex-1 text-xs text-muted">
                  Can&apos;t auto-read this format — match it to a client after import and it&apos;ll be stored in
                  their folder.
                </div>
              </div>
            ))}
          </Card>
          <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-[oklch(0.85_0.05_148_/_0.5)] bg-[oklch(0.94_0.03_148_/_0.45)] px-[18px] py-3.5">
            <div className="min-w-[200px] flex-1 text-[13px] leading-[1.55] text-[oklch(0.35_0.04_148)]">
              Will create <b>{newCount} folder{newCount === 1 ? "" : "s"} + Doc{newCount === 1 ? "" : "s"}</b> in
              Drive › CSTL › Clients, merge {mergeCount} duplicate{mergeCount === 1 ? "" : "s"}, and update{" "}
              {proposals.length} row{proposals.length === 1 ? "" : "s"} on the marketing sheet ({marketingCount}{" "}
              consented).
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
                <span>Old notes appended to each Doc, originals kept in the folder</span>
              </div>
              <div className="flex gap-2 text-[13px] text-[oklch(0.42_0.02_60)]">
                <span className="text-sage-text">✓</span>
                <span>Marketing sheet updated</span>
              </div>
              <div className="flex gap-2 text-[13px] text-[oklch(0.42_0.02_60)]">
                <span className="text-sage-text">✓</span>
                <span>
                  {summary.merged} duplicate{summary.merged === 1 ? "" : "s"} merged — still one record each
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
