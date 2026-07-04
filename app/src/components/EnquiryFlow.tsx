"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  Card,
  OutlineButton,
  PrimaryButton,
  SectionLabel,
  TintButton,
  inputClass,
  useToast,
} from "./ui";
import {
  blockedRange,
  CLINIC_LABEL,
  planBookingEvents,
  type Clinic,
} from "@/lib/booking/rules";
import { fmtDayShort, fmtTime, londonDayStart } from "@/lib/time";

interface Analysis {
  name: string;
  phone: string;
  email: string;
  clinicSuggestion: Clinic | null;
  clinicReason: string;
  requestedWhen: string;
}

interface BusySpan {
  start: string;
  end: string;
  title: string;
  known: boolean;
}

const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const SLOT_MINUTES = 15;

export function EnquiryFlow({
  openEnquiryId,
  existingClient,
}: {
  openEnquiryId?: string;
  existingClient?: { id: string; name: string; clinic: string };
}) {
  const router = useRouter();
  const toast = useToast();

  const [text, setText] = useState("");
  const [enquiryId, setEnquiryId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [reading, setReading] = useState(false);
  const [clinic, setClinic] = useState<Clinic>((existingClient?.clinic as Clinic) || "waterloo");
  const [spans, setSpans] = useState<BusySpan[] | null>(null);
  const [selected, setSelected] = useState<Date | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendPayment, setSendPayment] = useState(false);
  const [emailBody, setEmailBody] = useState("");
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<{ whenLabel: string; items: string[]; emailTextForClipboard?: string } | null>(
    null,
  );

  const clientName = existingClient?.name || analysis?.name || "";
  const stage: "paste" | "book" | "done" = result ? "done" : analysis || existingClient ? "book" : "paste";

  useEffect(() => {
    if (openEnquiryId) void loadEnquiry(openEnquiryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEnquiryId]);

  useEffect(() => {
    if (stage === "book") void loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function loadEnquiry(id: string) {
    setReading(true);
    try {
      const { enquiry, analysis: a } = await api<{ enquiry: { id: string; text: string }; analysis: Analysis }>(
        `/api/enquiries/${id}`,
      );
      setText(enquiry.text);
      setEnquiryId(enquiry.id);
      setAnalysis(a);
      if (a.clinicSuggestion) setClinic(a.clinicSuggestion);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load that enquiry");
    } finally {
      setReading(false);
    }
  }

  async function readMessage() {
    if (!text.trim()) {
      toast("Paste a message first");
      return;
    }
    setReading(true);
    try {
      const { enquiry, analysis: a } = await api<{ enquiry: { id: string }; analysis: Analysis }>("/api/enquiries", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setEnquiryId(enquiry.id);
      setAnalysis(a);
      if (a.clinicSuggestion) setClinic(a.clinicSuggestion);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read that message");
    } finally {
      setReading(false);
    }
  }

  async function loadAvailability() {
    try {
      const { spans: s } = await api<{ spans: BusySpan[] }>("/api/availability?days=7");
      setSpans(s);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't load your calendar");
    }
  }

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => londonDayStart(i)), []);

  const isFree = (slotStart: Date) => {
    if (!spans) return false;
    const { start, end } = blockedRange(clinic, slotStart);
    return !spans.some((s) => new Date(s.start) < end && new Date(s.end) > start);
  };

  const plan = selected ? planBookingEvents(clinic, clientName || "New client", selected) : [];

  async function confirmBooking() {
    if (!selected) return;
    setBooking(true);
    try {
      const req: Record<string, unknown> = {
        clinic,
        startISO: selected.toISOString(),
        sendEmail,
        sendPayment,
        emailBody: emailBody.trim() || undefined,
        enquiryId,
      };
      if (existingClient) req.clientId = existingClient.id;
      else req.newClient = { name: clientName, email: analysis?.email, phone: analysis?.phone };

      const res = await api<{ whenLabel: string; items: string[]; emailTextForClipboard?: string }>("/api/book", {
        method: "POST",
        body: JSON.stringify(req),
      });
      if (res.emailTextForClipboard) {
        await navigator.clipboard?.writeText(res.emailTextForClipboard).catch(() => {});
      }
      setResult(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't book that session");
    } finally {
      setBooking(false);
    }
  }

  if (stage === "done" && result) {
    return (
      <div className="flex max-w-[640px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
        <Card className="flex flex-col gap-2 px-6 py-6 text-center">
          <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
            ✓
          </div>
          <div className="font-serif text-2xl font-medium">Booked — {result.whenLabel}</div>
          <div className="mt-2 flex flex-col gap-1.5 text-left text-[13px]">
            {result.items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-sage-text">✓</span>
                <span>{it}</span>
              </div>
            ))}
          </div>
          <PrimaryButton className="mt-4 self-center" onClick={() => router.push("/")}>
            Back to Today
          </PrimaryButton>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex max-w-[1080px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header>
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Enquiries</h1>
        <div className="mt-[5px] text-[13.5px] text-muted">
          Paste a WhatsApp or email message — I&apos;ll pick out the details and suggest a clinic.
        </div>
      </header>

      {stage === "paste" && (
        <Card className="flex flex-col gap-3 px-5 py-5">
          <SectionLabel>PASTE THE ENQUIRY</SectionLabel>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Hi Phoenix! I'm..."
            className="min-h-[140px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-sm leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
          />
          <PrimaryButton onClick={readMessage} disabled={reading} className="self-start">
            {reading ? "Reading…" : "Read message"}
          </PrimaryButton>
        </Card>
      )}

      {stage === "book" && (
        <>
          <Card className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-serif text-lg font-medium">{clientName || "New client"}</div>
                <div className="text-[12.5px] text-muted">
                  {[analysis?.phone, analysis?.email].filter(Boolean).join(" · ") || "No contact details found"}
                </div>
              </div>
              <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
                {(["waterloo", "bethnal"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setClinic(c);
                      setSelected(null);
                    }}
                    className={`cursor-pointer rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
                      clinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                    }`}
                  >
                    {CLINIC_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
            {analysis?.clinicReason && (
              <div className="text-xs text-muted">Suggested: {analysis.clinicReason}</div>
            )}
            {analysis?.requestedWhen && (
              <div className="text-xs text-muted">Asked for: {analysis.requestedWhen}</div>
            )}
          </Card>

          <SectionLabel>NEXT 7 DAYS — {GRID_START_HOUR}:00–{GRID_END_HOUR}:00</SectionLabel>
          {!spans ? (
            <div className="flex h-[160px] items-center justify-center rounded-2xl border border-line bg-card text-[13.5px] text-muted">
              Loading your calendar…
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {days.map((day) => (
                <div key={day.toISOString()} className="flex w-[110px] flex-none flex-col gap-1">
                  <div className="text-center text-[12px] font-semibold">{fmtDayShort(day)}</div>
                  <div className="flex flex-col gap-[3px]">
                    {Array.from({ length: ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES }, (_, i) => {
                      const slot = new Date(day.getTime() + (GRID_START_HOUR * 60 + i * SLOT_MINUTES) * 60_000);
                      const free = isFree(slot);
                      const isSelected = selected?.getTime() === slot.getTime();
                      return (
                        <button
                          key={i}
                          disabled={!free}
                          onClick={() => setSelected(slot)}
                          className={`cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-medium tabular-nums ${
                            isSelected
                              ? "bg-clay text-cream"
                              : free
                                ? "bg-free text-[oklch(0.35_0.05_148)] hover:bg-sage/40"
                                : "cursor-default bg-busy text-faint"
                          }`}
                        >
                          {fmtTime(slot)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <Card className="flex flex-col gap-3 border-[1.5px] border-clay/35 px-5 py-4">
              <SectionLabel>BOOKING PREVIEW</SectionLabel>
              <div className="flex flex-col gap-1.5 text-[13px]">
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
              {!existingClient && (
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={sendPayment} onChange={(e) => setSendPayment(e.target.checked)} />
                  New client — include payment details
                </label>
              )}
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder="(optional) override the email body before sending…"
                className={`${inputClass} min-h-[90px] resize-y`}
              />
              <div className="flex gap-2">
                <OutlineButton onClick={() => setSelected(null)}>Change slot</OutlineButton>
                <PrimaryButton onClick={confirmBooking} disabled={booking}>
                  {booking ? "Booking…" : sendEmail ? "Create events & send email" : "Create events"}
                </PrimaryButton>
              </div>
            </Card>
          )}

          {enquiryId && !selected && (
            <TintButton
              className="self-start"
              onClick={async () => {
                await api(`/api/enquiries/${enquiryId}/dismiss`, { method: "POST" });
                toast("Enquiry dismissed");
                router.push("/");
              }}
            >
              Dismiss enquiry
            </TintButton>
          )}
        </>
      )}
    </div>
  );
}
