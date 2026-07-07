"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CLINIC_LABEL, CLINIC_PRICE, planBookingEvents, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { api, Card, OutlineButton, PrimaryButton, SectionLabel, inputClass, useToast } from "../ui";

interface ClientHit {
  id: string;
  name: string;
  clinic: string;
  email: string;
}

/**
 * Book an existing client straight from a calendar slot. New people come in
 * through Enquiries (paste their message) — linked below the search.
 */
export function QuickBook({
  slot,
  onClose,
  onBooked,
}: {
  slot: Date;
  onClose: () => void;
  onBooked: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [client, setClient] = useState<ClientHit | null>(null);
  const [clinic, setClinic] = useState<Clinic>("bethnal");
  const [sendEmail, setSendEmail] = useState(true);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    if (!query.trim() || client) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ clients: ClientHit[] }>(`/api/clients?query=${encodeURIComponent(query.trim())}`)
        .then((d) => setHits(d.clients))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, client]);

  const plan = client ? planBookingEvents(clinic, client.name, slot) : [];

  async function book() {
    if (!client) return;
    setBooking(true);
    try {
      const res = await api<{ whenLabel: string; emailTextForClipboard?: string }>("/api/book", {
        method: "POST",
        body: JSON.stringify({
          clientId: client.id,
          clinic,
          startISO: slot.toISOString(),
          sendEmail,
          sendPayment: false,
        }),
      });
      if (res.emailTextForClipboard) {
        await navigator.clipboard?.writeText(res.emailTextForClipboard).catch(() => {});
      }
      toast(`Booked — ${res.whenLabel}`);
      onBooked();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't book that slot");
      setBooking(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[oklch(0.3_0.02_60_/_0.18)]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2">
        <Card className="flex flex-col gap-3 p-5">
          <div>
            <div className="font-serif text-[19px] font-medium">Book this slot</div>
            <div className="mt-0.5 text-[13px] text-muted">
              {fmtDayLong(slot)} · {fmtTime(slot)} — 60 min session
            </div>
          </div>

          {!client ? (
            <div className="relative">
              <SectionLabel className="mb-1.5">WHO IS IT FOR?</SectionLabel>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your clients…"
                className={inputClass}
              />
              {hits.length > 0 && (
                <div className="absolute right-0 left-0 z-10 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-pop">
                  {hits.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        setClient(h);
                        setClinic((h.clinic as Clinic) || "bethnal");
                      }}
                      className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5 text-left text-[13px] hover:bg-hoverbg"
                    >
                      <span className="font-medium">{h.name}</span>
                      <span className="text-[11.5px] text-muted">{CLINIC_LABEL[h.clinic as Clinic] ?? h.clinic}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 text-[12.5px] text-muted">
                Someone new?{" "}
                <Link href="/enquiries" className="font-semibold text-clay-text hover:text-clay">
                  New enquiry instead ›
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[14px] font-semibold">{client.name}</div>
                <button
                  onClick={() => setClient(null)}
                  className="cursor-pointer text-[12px] font-semibold text-muted hover:text-ink"
                >
                  change
                </button>
              </div>
              <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px] self-start">
                {(["bethnal", "waterloo"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setClinic(c)}
                    className={`cursor-pointer rounded-full px-3.5 py-[6px] text-[12px] font-semibold select-none ${
                      clinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                    }`}
                  >
                    {CLINIC_LABEL[c]} · {CLINIC_PRICE[c].split(" ")[0]}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1 text-[12.5px]">
                {plan.map((ev, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-clay">•</span>
                    <span>
                      &quot;{ev.summary}&quot; — {fmtTime(ev.start)}–{fmtTime(ev.end)}
                    </span>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                Send confirmation email
              </label>
            </>
          )}

          <div className="flex gap-2">
            <OutlineButton onClick={onClose}>Close</OutlineButton>
            {client && (
              <PrimaryButton onClick={book} disabled={booking}>
                {booking ? "Booking…" : "Book"}
              </PrimaryButton>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
