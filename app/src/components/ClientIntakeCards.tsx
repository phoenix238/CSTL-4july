"use client";

import { useState } from "react";
import { useClientDraft } from "./clientDrafts";
import { useRouter } from "next/navigation";
import { extendedIntakeFields, readLegacyIntakeReason, type IntakeAnswer } from "@/lib/intakeProfile";
import { CONSENT_PARAGRAPHS, type IntakeQuestion } from "@/lib/intakeQuestions";
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

export function MedicationLinks({ text }: { text: string }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
      {text.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean).map((entry, index) => {
        const medicine = entry.split(/\s*(?:\(|\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b|\s+(?:for|during|as needed)\s+)/i)[0].trim();
        return medicine ? (
          <a key={index} href={`https://www.google.com/search?q=${encodeURIComponent(medicine + " medication")}`}
            target="_blank" rel="noreferrer" className="text-clay-text underline underline-offset-2"
            title={`Search Google for ${medicine}`}>{entry}</a>
        ) : <span key={index}>{entry}</span>;
      })}
    </div>
  );
}

export function FirstSessionCard({ clientId, answers, submitted, initial, docId, questions, consentGiven, profileDefaults }: {
  clientId: string;
  answers: IntakeAnswer[];
  submitted: string | null;
  initial: Record<string, string>;
  docId: string;
  questions: IntakeQuestion[];
  consentGiven: boolean | null;
  profileDefaults: Record<string, string>;
}) {
  const initialValues: Record<string, string> = { ...initial, consent: consentGiven === null ? "" : String(consentGiven) };
  const [draft, setDraft, clearDraft] = useClientDraft(`intake:${clientId}`, initialValues);
  const [saved, setSaved] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [legacy, setLegacy] = useState<IntakeAnswer[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const displayed = answers.length ? answers : legacy;
  const fields = extendedIntakeFields(questions, displayed);
  const dirty = fields.some(({ key }) => saved[key] !== draft[key]) ||
    saved.consent !== draft.consent;

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
      const consent = draft.consent;
      const notes = Object.fromEntries(fields.filter(({ key }) => draft[key] !== saved[key]).map(({ key }) => [key, draft[key]]));
      await api(`/api/clients/${clientId}/first-session`, {
        method: "PUT",
        body: JSON.stringify({ notes, ...(consent !== saved.consent ? { consent: consent === "true" } : {}) }),
      });
      setSaved(draft);
      clearDraft(draft);
      router.refresh();
      toast("Extended intake saved");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the intake.");
    } finally {
      setSaving(false);
    }
  }

  function field({ key, label, original }: (typeof fields)[number]) {
    const value = draft[key] ?? (original || profileDefaults[key] || "");
    return (
      <div key={key} className="min-w-0">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{key === "reason" ? "Why they’re coming" : label}</span>
          {original && value === original && <span className="text-xs text-muted">Client’s response{submitted && ` · ${submitted}`}</span>}
          <textarea className={inputClass} rows={key === "reason" ? Math.min(10, Math.max(3, Math.ceil(value.length / 95))) : 2}
            maxLength={20000} value={value} disabled={saving}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </label>
        {key === "meds" && value && <MedicationLinks text={value} />}
        {original && value !== original && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-clay-text">Original client response</summary>
            <p className="mt-1 whitespace-pre-wrap">{original}</p>
          </details>
        )}
      </div>
    );
  }

  return (
    <div id="extended-intake" className="scroll-mt-4">
      <Card className="mb-3 flex flex-col gap-3 p-4">
        <SectionLabel>EXTENDED INTAKE</SectionLabel>
        {field(fields[0])}
        {!answers.length && docId && !checked && (
          <div><TintButton disabled={checking} onClick={loadLegacy}>{checking ? "Checking…" : "Find intake in linked Google Doc"}</TintButton></div>
        )}
        {checked && !legacy.length && <p className="text-sm text-muted">No matching intake section was found in the linked Doc.</p>}
        <details className="rounded-lg border border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Health history and practitioner notes</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{fields.slice(1).map(field)}</div>
          <details className="mt-3 rounded-lg border border-line p-3">
            <summary className="cursor-pointer font-semibold">Consent{draft.consent && ` · ${draft.consent === "true" ? "Given" : "Declined"}`}</summary>
            <div className="my-2 space-y-1 text-xs">{CONSENT_PARAGRAPHS.map((text) => <p key={text}>{text}</p>)}</div>
            <label className="flex flex-col gap-1">
              <span>Client’s consent in person</span>
              <select className={inputClass} value={draft.consent} disabled={saving}
                onChange={(event) => setDraft({ ...draft, consent: event.target.value })}>
                <option value="" disabled>Not recorded</option>
                <option value="true">Given</option>
                <option value="false">Declined</option>
              </select>
            </label>
          </details>
        </details>
        <div className="flex items-center gap-3">
          <TintButton disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save extended intake"}</TintButton>
          {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
        </div>
      </Card>
    </div>
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
    <Card className="p-4">
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
