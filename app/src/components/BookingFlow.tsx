"use client";

import { useState } from "react";
import { api, Card, PrimaryButton, inputClass, useToast } from "./ui";
import { BookSlotPicker } from "./BookSlotPicker";
import { CLINIC_LABEL, CLINIC_PRICE, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong, fmtTime } from "@/lib/time";

export function BookingFlow({ waterlooAddress, bethnalAddress }: { waterlooAddress: string; bethnalAddress: string }) {
  const toast = useToast();
  const [clinic, setClinic] = useState<Clinic>("bethnal");
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState(""); // honeypot — real visitors never see or fill this
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ whenLabel: string; email: string } | null>(null);

  const address = clinic === "waterloo" ? waterlooAddress : bethnalAddress;

  async function submit() {
    if (!selected) {
      toast("Pick a time first");
      return;
    }
    if (!name.trim()) {
      toast("Please add your name");
      return;
    }
    if (!email.trim()) {
      toast("Please add your email");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<{ whenLabel: string; clientName: string; emailSent: boolean }>("/api/public/book", {
        method: "POST",
        body: JSON.stringify({ clinic, startISO: selected, name, email, phone, company }),
      });
      setConfirmed({ whenLabel: result.whenLabel, email });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't book that — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
          ✓
        </div>
        <div className="font-serif text-2xl font-medium">You&apos;re booked</div>
        <p className="text-[14px] leading-relaxed text-muted">
          {confirmed.whenLabel}. A confirmation email is on its way to {confirmed.email}, with everything you need
          before your session.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[600px] px-5 py-10">
      <header className="mb-6 text-center">
        <h1 className="font-serif text-[28px] leading-[1.1]">Book a session</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">Craniosacral therapy with Phoenix Tanner.</p>
      </header>

      <Card className="flex flex-col gap-4 px-5 py-6">
        <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
          {(["bethnal", "waterloo"] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                setClinic(c);
                setSelected(null);
              }}
              className={`flex-1 cursor-pointer rounded-full px-3.5 py-2 text-[13px] font-semibold select-none ${
                clinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
              }`}
            >
              {CLINIC_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="text-[12.5px] text-muted">
          {CLINIC_PRICE[clinic]} · 60 minutes{address ? ` · ${address}` : ""}
        </div>

        <BookSlotPicker clinic={clinic} selected={selected} onSelect={setSelected} />

        {selected && (
          <div className="flex flex-col gap-3 border-t border-hairline pt-4">
            <div className="text-[13px] font-semibold">
              {fmtDayLong(new Date(selected))} at {fmtTime(new Date(selected))}
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-soft">Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-soft">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-soft">Phone (optional)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute left-[-9999px] h-0 w-0 opacity-0"
            />
            <PrimaryButton onClick={submit} disabled={submitting} className="mt-1 py-3">
              {submitting ? "Booking…" : "Confirm booking"}
            </PrimaryButton>
          </div>
        )}
      </Card>
    </div>
  );
}
