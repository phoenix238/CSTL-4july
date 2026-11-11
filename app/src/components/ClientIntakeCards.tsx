"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FIRST_SESSION_FIELDS, readLegacyIntakeReason, type IntakeAnswer } from "@/lib/intakeProfile";
import { api, Card, inputClass, SectionLabel, TintButton, useToast } from "./ui";

export function IntakeExcerpt({ answer }: { answer: IntakeAnswer }) {
  return (
    <details className="group py-2">
      <summary className="cursor-pointer text-xs font-semibold text-ink-soft">{answer.label}</summary>
      <p className="mt-1 whitespace-pre-wrap text-sm group-open:hidden line-clamp-2">{answer.answer}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm hidden group-open:block">{answer.answer}</p>
    </details>
  );
}

export function FirstSessionCard({ clientId, answers, submitted, initial, docId }: {
  clientId: string;
  answers: IntakeAnswer[];
  submitted: string | null;
  initial: Record<string, string>;
  docId: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [legacy, setLegacy] = useState<IntakeAnswer[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const toast = useToast();
  const displayed = answers.length ? answers : legacy;
  const reason = displayed.find((answer) => answer.key === "caseHistory");
  const dirty = Object.keys(FIRST_SESSION_FIELDS).some((key) => (saved[key] ?? "") !== (draft[key] ?? ""));

  async function loadLegacy() {
    setChecking(true);
    try {
      const result = await api<{ text: string }>(`/api/clients/${clientId}/history-docs?doc=${encodeURIComponent(docId)}`);
      setLegacy(readLegacyIntakeReason(result.text));
      setChecked(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not read the linked intake.");
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/first-session`, { method: "PUT", body: JSON.stringify(draft) });
      setSaved(draft);
      toast("First-session notes saved");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save first-session notes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-3 flex flex-col gap-3 p-4">
      <SectionLabel>FIRST-SESSION INTAKE</SectionLabel>
      {reason && (
        <div>
          <h2 className="font-semibold">Why they’re coming</h2>
          <p className="text-xs text-muted">{submitted ? `Client’s words · ${submitted}` : "Client’s words from the linked intake"}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{reason.answer}</p>
        </div>
      )}
      {!reason && <p className="text-sm text-muted">No reason for coming is saved in the CRM.</p>}
      {!answers.length && docId && !checked && (
        <div><TintButton disabled={checking} onClick={loadLegacy}>{checking ? "Checking…" : "Find intake in linked Google Doc"}</TintButton></div>
      )}
      {checked && !legacy.length && <p className="text-sm text-muted">No matching intake section was found in the linked Doc.</p>}
      {displayed.some((answer) => answer.key !== "caseHistory") && (
        <details className="rounded-lg border border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Full intake responses</summary>
          {displayed.filter((answer) => answer.key !== "caseHistory").map((answer) => (
            <div key={answer.key} className="mt-3">
              <h3 className="font-semibold">{answer.label}</h3>
              <p className="whitespace-pre-wrap">{answer.answer}</p>
            </div>
          ))}
        </details>
      )}
      <details className="rounded-lg border border-line p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Practitioner notes{dirty ? " · Unsaved changes" : ""}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(FIRST_SESSION_FIELDS).map(([key, label]) => {
            const clientAnswer = displayed.find((answer) => answer.key === (key === "reason" ? "caseHistory" : key === "health" ? "conditions" : key));
            return (
              <label key={key} className="flex flex-col gap-1">
                <span className="font-medium">{label}</span>
                {clientAnswer && <span className="line-clamp-2 whitespace-pre-wrap text-xs text-muted">{clientAnswer.answer}</span>}
                <textarea
                  className={inputClass}
                  rows={2}
                  maxLength={20000}
                  value={draft[key] ?? ""}
                  onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))}
                />
              </label>
            );
          })}
        </div>
        <div className="mt-3"><TintButton disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save first-session notes"}</TintButton></div>
      </details>
    </Card>
  );
}

export function ClientHistoryDocs({ clientId, primaryDoc, historyDocs }: {
  clientId: string;
  primaryDoc: string;
  historyDocs: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState("");
  const [current, setCurrent] = useState<{ id: string; name: string; text: string } | null>(null);
  const ids = [...new Set([primaryDoc, ...historyDocs].filter(Boolean))];

  async function load(doc: string) {
    setPending(doc);
    try {
      const data = await api<{ name: string; text: string }>(`/api/clients/${clientId}/history-docs?doc=${encodeURIComponent(doc)}`);
      setCurrent({ id: doc, ...data });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not read the case history.");
    } finally {
      setPending("");
    }
  }

  return (
    <Card className="mt-3 p-4">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Case history from Google Drive</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {ids.map((id, i) => (
            <TintButton key={id} disabled={!!pending} onClick={() => load(id)}>
              {pending === id ? "Reading…" : current?.id === id ? "Refresh document" : id === primaryDoc ? "Read linked client record" : `Read additional Doc ${i + (primaryDoc ? 0 : 1)}`}
            </TintButton>
          ))}
        </div>
        {current && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{current.name}</h3>
              {current.id !== primaryDoc && <button type="button" disabled={!!pending} className="cursor-pointer text-xs text-clay-text hover:underline" onClick={async () => {
                const doc = current.id;
                setPending(doc);
                try {
                  await api(`/api/clients/${clientId}/history-docs?doc=${encodeURIComponent(doc)}`, { method: "DELETE" });
                  setCurrent(null);
                  router.refresh();
                } catch (error) {
                  toast(error instanceof Error ? error.message : "Could not unlink the document.");
                } finally {
                  setPending("");
                }
              }}>Unlink from profile</button>}
            </div>
            <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line p-3 text-sm">{current.text}</p>
          </div>
        )}
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (event) => {
          event.preventDefault();
          setAdding(true);
          try {
            const result = await api<{ linked: boolean }>(`/api/clients/${clientId}/history-docs`, { method: "POST", body: JSON.stringify({ doc: link }) });
            toast(result.linked ? "Case history document linked" : "This document is already linked");
            setLink("");
            router.refresh();
          } catch (error) {
            toast(error instanceof Error ? error.message : "Could not link the document.");
          } finally {
            setAdding(false);
          }
        }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            Additional Google Doc for this client
            <input className={inputClass} value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a Google Docs link" required />
          </label>
          <TintButton type="submit" disabled={adding || !link.trim()}>{adding ? "Linking…" : "Link case history"}</TintButton>
        </form>
      </details>
    </Card>
  );
}

export function ClientEmailAliases({ clientId, emails }: { clientId: string; emails: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const endpoint = `/api/clients/${clientId}/alternate-emails`;

  async function update(remove?: string) {
    setPending(true);
    try {
      if (remove) {
        await api(`${endpoint}?email=${encodeURIComponent(remove)}`, { method: "DELETE" });
      } else {
        await api(endpoint, { method: "POST", body: JSON.stringify({ email }) });
        setEmail("");
      }
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update alternate emails.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="px-4 py-3 text-sm">
      <details>
        <summary className="cursor-pointer font-semibold">Alternate emails{emails.length ? ` (${emails.length})` : ""}</summary>
        <p className="my-2 text-xs text-muted">Used to find this record in Enquiries. Messages go to the main email.</p>
        {emails.map((address) => (
          <div key={address} className="mb-2 flex items-center justify-between gap-2">
            <span className="break-all">{address}</span>
            <button type="button" className="cursor-pointer text-xs text-clay-text hover:underline" disabled={pending} onClick={() => update(address)} aria-label={`Unlink ${address}`}>Unlink</button>
          </div>
        ))}
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void update(); }}>
          <input aria-label="Alternate email address" className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Alternate email address" required />
          <TintButton type="submit" disabled={pending || !email.trim()}>Link email</TintButton>
        </form>
      </details>
    </Card>
  );
}
