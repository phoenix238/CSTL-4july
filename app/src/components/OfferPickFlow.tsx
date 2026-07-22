"use client";

import { useEffect, useState } from "react";
import { api, Card, PrimaryButton, useToast } from "./ui";
import { BookingConfirmation } from "./BookingConfirmation";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong, fmtTime } from "@/lib/time";

/**
 * The client-facing "pick one of the times Phoenix offered" page. Deliberately
 * not BookingFlow.tsx: there's no contact form (the client is already known —
 * that's what the offer token identifies) and no live-slots fetch — the
 * candidate times are the small, fixed set already offered; only their
 * continued *freeness* is re-checked, on mount, against the offer token API.
 */
export function OfferPickFlow({
  token,
  clientName,
  clientEmail,
  clinic,
  offeredTimes,
}: {
  token: string;
  clientName: string;
  clientEmail: string;
  clinic: Clinic;
  offeredTimes: string[];
}) {
  const toast = useToast();
  const [freeTimes, setFreeTimes] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [company, setCompany] = useState(""); // honeypot — real visitors never see or fill this
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ whenLabel: string; emailSent: boolean; intakeUrl: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    api<{ status: string; freeTimes?: string[] }>(`/api/public/offer/${token}`)
      .then((res) => {
        if (!cancelled) setFreeTimes(res.freeTimes ?? []);
      })
      .catch(() => {
        if (!cancelled) setFreeTimes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit() {
    if (!selected) {
      toast("Pick a time first");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<{ whenLabel: string; emailSent: boolean; intakeUrl: string }>(
        `/api/public/offer/${token}`,
        { method: "POST", body: JSON.stringify({ startISO: selected, company }) },
      );
      setConfirmed({ whenLabel: result.whenLabel, emailSent: result.emailSent, intakeUrl: result.intakeUrl });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't book that — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <BookingConfirmation
        whenLabel={confirmed.whenLabel}
        emailSent={confirmed.emailSent}
        email={clientEmail}
        intakeUrl={confirmed.intakeUrl}
      />
    );
  }

  const first = clientName.trim() ? clientName.trim().split(/\s+/)[0] : "there";

  return (
    <div className="mx-auto max-w-[600px] px-5 py-10">
      <header className="mb-6 text-center">
        <h1 className="font-serif text-[28px] leading-[1.1]">Pick a time, {first}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Here are the times offered for {CLINIC_LABEL[clinic]} — tap one to book it straight away.
        </p>
      </header>

      <Card className="relative flex flex-col gap-3 px-5 py-6">
        {freeTimes === null ? (
          <div className="text-[13px] text-muted">Checking availability…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {offeredTimes.map((iso) => {
              const d = new Date(iso);
              const free = freeTimes.includes(iso);
              return (
                <button
                  key={iso}
                  disabled={!free}
                  onClick={() => setSelected(iso)}
                  className={`cursor-pointer rounded-xl border px-4 py-3 text-left text-[13.5px] font-medium select-none disabled:cursor-not-allowed ${
                    !free
                      ? "border-line bg-[oklch(0.96_0.01_75)] text-faint line-through"
                      : selected === iso
                        ? "border-clay bg-clay text-cream"
                        : "border-line bg-card text-ink-soft hover:bg-hoverbg"
                  }`}
                >
                  {fmtDayLong(d)} at {fmtTime(d)}
                  {!free && <span className="ml-2 text-[12px] font-normal no-underline">— no longer available</span>}
                </button>
              );
            })}
          </div>
        )}

        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        <PrimaryButton onClick={submit} disabled={submitting || !selected} className="mt-1 py-3">
          {submitting ? "Booking…" : "Confirm this time"}
        </PrimaryButton>
      </Card>
    </div>
  );
}
