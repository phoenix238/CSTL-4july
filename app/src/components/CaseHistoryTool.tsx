"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Card, Chip, OutlineButton, PrimaryButton, SectionLabel, useToast } from "./ui";

interface Row {
  id: string;
  name: string;
  docId: string;
  formattedAt: string | null;
  intakeDone: boolean;
  hasNarrative: boolean;
  sessions: number;
}

interface ReformatResult {
  docId: string;
  url: string;
  filled: string[];
  recoveredSessions: number;
  keptOriginal: boolean;
  readError: string;
}

/** Per-row state while a pass is running. */
type RowState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; result: ReformatResult }
  | { status: "failed"; error: string };

/** The headers every Doc ends up with — shown so it's clear what the pass does. */
const LAYOUT = [
  "AT A GLANCE",
  "1. INTAKE FORM — as they submitted it",
  "2. PRESENTING ISSUE",
  "3. HISTORY OF PRESENTING ISSUE",
  "4. MEDICAL HISTORY",
  "5. MEDICATIONS & SUPPLEMENTS",
  "6. PREVIOUS TREATMENT / THERAPIES",
  "7. LIFESTYLE, WORK & STRESSORS",
  "8. BIRTH & DEVELOPMENTAL HISTORY",
  "9. INJURIES, ACCIDENTS & SURGERY",
  "10. RED FLAGS / CAUTIONS",
  "11. GOALS — WHAT THEY WANT FROM THE WORK",
  "12. TREATMENT PLAN",
  "13. SESSION LOG — newest first",
  "14. CONSENT & DATA",
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function StatusChip({ row, state }: { row: Row; state: RowState }) {
  if (state.status === "working") return <Chip color="oklch(0.42 0.1 42)" bg="oklch(0.94 0.03 48)">Working…</Chip>;
  if (state.status === "failed") return <Chip color="oklch(0.45 0.15 25)" bg="oklch(0.94 0.04 25)">Failed</Chip>;
  if (state.status === "done") return <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">Just done</Chip>;
  if (!row.docId) return <Chip color="oklch(0.5 0.02 58)" bg="oklch(0.94 0.01 80)">No Doc yet</Chip>;
  if (row.formattedAt)
    return <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">{`Formatted ${fmtWhen(row.formattedAt)}`}</Chip>;
  return <Chip color="oklch(0.5 0.02 58)" bg="oklch(0.94 0.01 80)">Old layout</Chip>;
}

/**
 * Bring every client's Google Doc onto the standard case-history layout — the
 * same numbered headers, in the same order, for everyone.
 *
 * Deliberately one client at a time, with the first one meant to be opened and
 * checked before the rest are run: each pass rewrites a real clinical record,
 * and while nothing is ever deleted (the old contents are kept under ORIGINAL
 * RECORD at the bottom of the Doc), it's still worth seeing one first.
 */
export function CaseHistoryTool() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [redo, setRedo] = useState(false);
  // The bulk loop checks this between clients — a state value would be the one
  // captured when the run started, and Stop would never be seen.
  const stopRef = useRef(false);

  const load = useCallback(() => {
    api<{ rows: Row[] }>("/api/case-history")
      .then((d) => setRows(d.rows))
      .catch((err) => {
        toast(err instanceof Error ? err.message : "Couldn't load your clients");
        setRows([]);
      });
  }, [toast]);

  useEffect(load, [load]);

  const todo = useMemo(() => (rows ?? []).filter((r) => redo || !r.formattedAt), [rows, redo]);
  const doneCount = (rows ?? []).filter((r) => r.formattedAt).length;
  const anyDoneThisSession = Object.values(states).some((s) => s.status === "done");

  const setState = (id: string, state: RowState) => setStates((s) => ({ ...s, [id]: state }));

  /** Reformat one client. Returns false when it failed, so a bulk run can count. */
  const reformat = useCallback(
    async (row: Row, reread: boolean): Promise<boolean> => {
      setState(row.id, { status: "working" });
      try {
        const result = await api<ReformatResult>(`/api/case-history/${row.id}`, {
          method: "POST",
          body: JSON.stringify({ reread }),
        });
        setState(row.id, { status: "done", result });
        setRows((current) =>
          (current ?? []).map((r) => (r.id === row.id ? { ...r, formattedAt: new Date().toISOString(), docId: result.docId } : r)),
        );
        return true;
      } catch (err) {
        setState(row.id, { status: "failed", error: err instanceof Error ? err.message : "Something went wrong" });
        return false;
      }
    },
    [],
  );

  const runOne = async (row: Row) => {
    setRunning(true);
    const ok = await reformat(row, !!row.formattedAt || redo);
    setRunning(false);
    toast(ok ? `${row.name}'s Doc is on the new layout ✓` : `Couldn't reformat ${row.name}`);
  };

  /**
   * The bulk pass. Sequential on purpose: each client is a Google Docs rewrite
   * plus a model call, and firing them all at once would only collect rate
   * limits. Stoppable between clients.
   */
  const runAll = async () => {
    if (!todo.length) return;
    setRunning(true);
    setStopRequested(false);
    stopRef.current = false;
    let ok = 0;
    let failed = 0;
    let stopped = false;

    for (const row of todo) {
      if (stopRef.current) {
        stopped = true;
        break;
      }
      const success = await reformat(row, redo);
      if (success) ok++;
      else failed++;
    }

    setRunning(false);
    setStopRequested(false);
    stopRef.current = false;
    const done = failed ? `${ok} reformatted, ${failed} couldn't be done` : `${ok} Docs reformatted ✓`;
    toast(stopped ? `Stopped — ${done}` : done);
  };

  if (!rows) {
    return <div className="p-6 text-[13px] text-muted">Loading your clients…</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="font-serif text-[22px] leading-tight">Case history layout</h1>
        <p className="mt-1 max-w-[64ch] text-[13px] leading-[1.55] text-ink-soft">
          Every client&apos;s Google Doc, rewritten to the same set of headers — intake form at the
          top, the clinical sections beneath it, session notes in a log that new notes drop into.
          What each Doc already holds is sorted into those sections and{" "}
          <strong className="font-semibold">also kept whole</strong> at the bottom under{" "}
          <em>Original record</em>, so nothing is lost. New clients get this layout from the start.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel>YOUR CLIENTS</SectionLabel>
              <div className="mt-1 text-[13px] text-ink-soft">
                {doneCount} of {rows.length} on the new layout
                {todo.length ? ` · ${todo.length} to go` : " · all done"}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
                <input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} disabled={running} />
                Include ones already done
              </label>
              {running ? (
                <OutlineButton
                  onClick={() => {
                    stopRef.current = true;
                    setStopRequested(true);
                  }}
                  disabled={stopRequested}
                >
                  {stopRequested ? "Stopping…" : "Stop"}
                </OutlineButton>
              ) : (
                <PrimaryButton onClick={runAll} disabled={!todo.length}>
                  {anyDoneThisSession ? `Reformat the other ${todo.length}` : `Reformat all ${todo.length}`}
                </PrimaryButton>
              )}
            </div>
          </div>

          {!anyDoneThisSession && todo.length > 1 && (
            <p className="mt-3 rounded-lg bg-clay-tint/60 px-3 py-2 text-[12.5px] leading-[1.5] text-clay-text">
              Run one first and open the Doc to check you like it — then reformat the rest.
            </p>
          )}

          <div className="mt-3 flex flex-col divide-y divide-line">
            {rows.map((row) => {
              const state = states[row.id] ?? ({ status: "idle" } as RowState);
              return (
                <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                  <div className="min-w-[140px] flex-1">
                    <div className="text-[13.5px] font-medium">{row.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted">
                      {row.intakeDone ? "Intake in" : "No intake yet"} · {row.sessions}{" "}
                      {row.sessions === 1 ? "note" : "notes"}
                    </div>
                  </div>

                  <StatusChip row={row} state={state} />

                  {row.docId && (
                    <a
                      href={`https://docs.google.com/document/d/${row.docId}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] font-semibold text-clay-text hover:underline"
                    >
                      Open Doc
                    </a>
                  )}

                  <button
                    onClick={() => runOne(row)}
                    disabled={running}
                    className="cursor-pointer rounded-full bg-clay-tint px-3 py-1 text-[12px] font-semibold text-clay-text disabled:cursor-default disabled:opacity-50"
                  >
                    {row.formattedAt ? "Redo" : "Reformat"}
                  </button>

                  {state.status === "done" && (
                    <div className="w-full text-[11.5px] leading-[1.5] text-muted">
                      {state.result.filled.length
                        ? `Filled ${state.result.filled.length} section${state.result.filled.length === 1 ? "" : "s"} from the old text`
                        : "Headers written — nothing in the old text to sort"}
                      {state.result.recoveredSessions
                        ? ` · ${state.result.recoveredSessions} past session${state.result.recoveredSessions === 1 ? "" : "s"} recovered`
                        : ""}
                      {state.result.keptOriginal ? " · original kept at the bottom" : ""}
                      {state.result.readError ? ` · couldn't read the old text (${state.result.readError})` : ""}
                    </div>
                  )}
                  {state.status === "failed" && (
                    <div className="w-full text-[11.5px] leading-[1.5] text-[oklch(0.5_0.15_25)]">{state.error}</div>
                  )}
                </div>
              );
            })}
            {!rows.length && <div className="py-6 text-center text-[13px] text-muted">No clients yet.</div>}
          </div>
        </Card>

        <Card className="h-fit p-4">
          <SectionLabel>THE LAYOUT</SectionLabel>
          <ol className="mt-2.5 flex flex-col gap-1.5">
            {LAYOUT.map((heading) => (
              <li key={heading} className="text-[12px] leading-[1.4] text-ink-soft">
                {heading}
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-[1.5] text-muted">
            Sections 2–12 are seeded from the intake form where it answers them, and are yours to
            write into. Section 13 is where every new note lands, newest first.
          </p>
        </Card>
      </div>
    </div>
  );
}
