"use client";

import Link from "next/link";
import { useState } from "react";
import { api, Card, inputClass, TintButton } from "./ui";

type Candidate = { id: string; name: string; email: string };
type Reviewed = Candidate & {
  phone: string;
  dob: string;
  paymentRef: string;
  intakeDone: boolean;
  documents: number;
  alternateEmails: { email: string }[];
  _count: { bookings: number; notes: number; recordings: number; enquiries: number };
};

export function DuplicateClientReview({ clientId }: { clientId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [review, setReview] = useState<{ current: Reviewed; candidate: Reviewed } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setBusy(true);
    setError("");
    setReview(null);
    setResults(null);
    try {
      const { clients } = await api<{ clients: Candidate[] }>(`/api/clients?query=${encodeURIComponent(query.trim())}`);
      setResults(clients.filter((client) => client.id !== clientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search profiles.");
    } finally {
      setBusy(false);
    }
  }

  async function compare(id: string) {
    setBusy(true);
    setError("");
    setReview(null);
    try {
      setReview(await api(`/api/clients/${clientId}/duplicate-review?candidate=${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not compare profiles.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 text-sm">
      <details>
        <summary className="cursor-pointer font-semibold">Review a possible duplicate</summary>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <input aria-label="Name or email of possible duplicate" className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" required />
          <TintButton type="submit" disabled={busy || !query.trim()}>Find profile</TintButton>
        </form>
        {error && <p role="alert" className="mt-2 text-clay-text">{error}</p>}
        {results?.length === 0 && <p className="mt-2 text-muted">No other matching profiles.</p>}
        {results?.map((result) => (
          <button key={result.id} type="button" onClick={() => compare(result.id)} disabled={busy} className="mt-2 block cursor-pointer text-left text-clay-text hover:underline">
            Compare {result.name}{result.email && ` · ${result.email}`}
          </button>
        ))}
        {review && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-muted">Review both records before choosing what to consolidate. This preview makes no changes.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[review.current, review.candidate].map((record) => (
                <div key={record.id} className="min-w-0 rounded-lg border border-line p-3">
                  <h3 className="font-semibold">{record.name}</h3>
                  <dl className="mt-1 break-words text-xs leading-relaxed">
                    <dt className="font-semibold">Contact and identity</dt>
                    <dd>{record.email || "No main email"} · {record.phone || "No phone"}</dd>
                    {record.alternateEmails.map(({ email }) => <dd key={email}>Alternate: {email}</dd>)}
                    <dd>{record.dob || "No date of birth"}</dd>
                    <dt className="mt-2 font-semibold">Records</dt>
                    <dd>{record._count.bookings} bookings · {record._count.enquiries} enquiries</dd>
                    <dd>{record._count.notes} notes · {record._count.recordings} recordings · {record.documents} Docs</dd>
                    <dd>{record.intakeDone ? "Intake complete" : "Intake pending"} · {record.paymentRef || "No payment reference"}</dd>
                  </dl>
                  {record.id !== clientId && <Link href={`/clients/${record.id}`} className="mt-2 block text-xs text-clay-text hover:underline">Open this profile ›</Link>}
                </div>
              ))}
            </div>
          </div>
        )}
      </details>
    </Card>
  );
}
