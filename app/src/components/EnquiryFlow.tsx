"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  Card,
  Chip,
  OutlineButton,
  PrimaryButton,
  SectionLabel,
  TintButton,
  inputClass,
  useToast,
} from "./ui";
import { CLINIC_LABEL, CLINIC_PRICE, planBookingEvents, type Clinic } from "@/lib/booking/rules";
import { composeBookingEmail, type EmailSettings } from "@/lib/booking/email";
import { fmtDayLong, fmtTime, londonDayStart, londonWeekStart } from "@/lib/time";
import { Legend } from "./calendar/Legend";
import { TimeGrid } from "./calendar/TimeGrid";
import { useWeekSpans } from "./calendar/useWeekSpans";
import { Inbox, type WaitingEnquiry } from "./enquiry/Inbox";

interface Analysis {
  name: string;
  phone: string;
  email: string;
  via: string;
  clinicSuggestion: Clinic | null;
  clinicReason: string;
  requestedWhen: string;
}

interface Match {
  id: string;
  name: string;
  clinic: string;
  email: string;
  welcomeSent: boolean;
  saved?: boolean;
}

interface BookResult {
  clientId: string;
  clientName: string;
  whenLabel: string;
  items: string[];
  emailTextForClipboard?: string;
}

export function EnquiryFlow({
  openEnquiryId,
  existingClient,
  initialWaiting,
}: {
  openEnquiryId?: string;
  existingClient?: { id: string; name: string; clinic: string; email: string; welcomeSent: boolean };
  initialWaiting: WaitingEnquiry[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [waiting, setWaiting] = useState<WaitingEnquiry[]>(initialWaiting);
  const [text, setText] = useState("");
  const [enquiryId, setEnquiryId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [reading, setReading] = useState(false);

  // book step
  const [name, setName] = useState("");
  const [match, setMatch] = useState<Match | null>(null);
  const [ignoreMatch, setIgnoreMatch] = useState(false);
  const [saved, setSaved] = useState<Match | null>(
    existingClient ? { ...existingClient, saved: true } : null,
  );
  const [saving, setSaving] = useState(false);
  const [clinic, setClinic] = useState<Clinic>((existingClient?.clinic as Clinic) || "waterloo");
  const [weekStart, setWeekStart] = useState(() => londonWeekStart());
  const [selected, setSelected] = useState<Date | null>(null);
  const [showWaitingList, setShowWaitingList] = useState(false);

  // booking panel
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [sendPayment, setSendPayment] = useState(false);
  const [emailBody, setEmailBody] = useState("");
  const [emailDirty, setEmailDirty] = useState(false);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<BookResult | null>(null);

  // done step name edit
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const stage: "paste" | "book" | "done" = result ? "done" : analysis || existingClient ? "book" : "paste";
  const activeClient = saved ?? (ignoreMatch ? null : match);
  const { spans, invalidate } = useWeekSpans(weekStart, 7);

  useEffect(() => {
    if (openEnquiryId) void loadEnquiry(openEnquiryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEnquiryId]);

  useEffect(() => {
    api<EmailSettings>("/api/settings").then(setSettings).catch(() => {});
  }, []);

  // Debounced dedupe check while the name is edited (only when nothing is saved yet).
  const matchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (saved || stage !== "book") return;
    clearTimeout(matchTimer.current);
    if (!name.trim()) {
      setMatch(null);
      return;
    }
    matchTimer.current = setTimeout(() => {
      const p = new URLSearchParams({ name: name.trim() });
      if (analysis?.email) p.set("email", analysis.email);
      if (analysis?.phone) p.set("phone", analysis.phone);
      api<{ match: Match | null }>(`/api/clients/match?${p}`)
        .then((d) => setMatch(d.match))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(matchTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, saved, stage]);

  // Live email preview — recomposed until the therapist edits it by hand.
  const composed = useMemo(() => {
    if (!settings || !selected) return null;
    const whenLabel = `${fmtDayLong(selected)} · ${fmtTime(selected)}`;
    return composeBookingEmail(
      { name: (activeClient?.name || name || "there").trim(), welcomeSent: activeClient?.welcomeSent ?? false },
      clinic,
      whenLabel,
      sendPayment,
      settings,
    );
  }, [settings, selected, clinic, sendPayment, activeClient, name]);

  useEffect(() => {
    if (composed && !emailDirty) setEmailBody(composed.body);
  }, [composed, emailDirty]);

  async function refreshWaiting() {
    try {
      const { enquiries } = await api<{ enquiries: WaitingEnquiry[] }>("/api/enquiries");
      setWaiting(enquiries);
    } catch {
      /* non-fatal */
    }
    router.refresh(); // sidebar badge
  }

  function applyLoaded(enq: { id: string; text: string; clientId?: string | null }, a: Analysis, m: Match | null) {
    setText(enq.text);
    setEnquiryId(enq.id);
    setAnalysis(a);
    setName(m?.saved ? m.name : a.name);
    setMatch(m && !m.saved ? m : null);
    setSaved(m?.saved ? m : null);
    setIgnoreMatch(false);
    setSelected(null);
    setEmailDirty(false);
    if (m?.saved && m.clinic) setClinic(m.clinic as Clinic);
    else if (a.clinicSuggestion) setClinic(a.clinicSuggestion);
  }

  async function loadEnquiry(id: string) {
    setReading(true);
    try {
      const d = await api<{ enquiry: { id: string; text: string; clientId: string | null }; analysis: Analysis; match: Match | null }>(
        `/api/enquiries/${id}`,
      );
      applyLoaded(d.enquiry, d.analysis, d.match);
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
      const d = await api<{ enquiry: { id: string; text: string }; analysis: Analysis; match: Match | null }>(
        "/api/enquiries",
        { method: "POST", body: JSON.stringify({ text }) },
      );
      applyLoaded(d.enquiry, d.analysis, d.match);
      void refreshWaiting();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read that message");
    } finally {
      setReading(false);
    }
  }

  async function saveAsClient() {
    if (!enquiryId || !name.trim()) {
      toast("A name is needed first");
      return;
    }
    setSaving(true);
    try {
      const d = await api<{ client: Match; existed: boolean }>(`/api/enquiries/${enquiryId}/client`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: analysis?.email, phone: analysis?.phone, clinic }),
      });
      setSaved({ ...d.client, saved: true });
      setName(d.client.name);
      toast(
        d.existed
          ? `Linked to ${d.client.name}'s existing record — one record kept`
          : `${d.client.name} saved — Drive folder + Doc ready`,
      );
      void refreshWaiting();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the client");
    } finally {
      setSaving(false);
    }
  }

  async function confirmBooking(send: boolean) {
    if (!selected) return;
    setBooking(true);
    try {
      const req: Record<string, unknown> = {
        clinic,
        startISO: selected.toISOString(),
        sendEmail: send,
        sendPayment,
        emailBody: emailBody.trim() || undefined,
        enquiryId,
      };
      if (activeClient) req.clientId = activeClient.id;
      else req.newClient = { name: name.trim(), email: analysis?.email, phone: analysis?.phone };

      const res = await api<BookResult>("/api/book", { method: "POST", body: JSON.stringify(req) });
      if (res.emailTextForClipboard) {
        await navigator.clipboard?.writeText(res.emailTextForClipboard).catch(() => {});
      }
      setResult(res);
      setNameDraft(res.clientName);
      invalidate();
      void refreshWaiting();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't book that session");
    } finally {
      setBooking(false);
    }
  }

  async function saveNameEdit() {
    if (!result || !nameDraft.trim() || nameDraft.trim() === result.clientName) {
      setEditingName(false);
      return;
    }
    try {
      await api(`/api/clients/${result.clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nameDraft.trim() }),
      });
      setResult({ ...result, clientName: nameDraft.trim() });
      toast("Name updated — Drive folder renamed too");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update the name");
    } finally {
      setEditingName(false);
    }
  }

  /* ---------------- done ---------------- */

  if (stage === "done" && result) {
    return (
      <div className="flex max-w-[640px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
        <Card className="flex flex-col gap-2 px-6 py-6 text-center">
          <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
            ✓
          </div>
          <div className="font-serif text-2xl font-medium">
            Booked —{" "}
            {editingName ? (
              <span className="inline-flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveNameEdit()}
                  className={`${inputClass} inline-block w-[220px] text-center font-sans`}
                />
                <button onClick={saveNameEdit} className="cursor-pointer text-[13px] font-semibold text-clay">
                  save
                </button>
              </span>
            ) : (
              <>
                <Link href={`/clients/${result.clientId}`} className="text-clay-text hover:text-clay">
                  {result.clientName}
                </Link>{" "}
                <button
                  onClick={() => setEditingName(true)}
                  title="Fix the name"
                  className="cursor-pointer align-middle text-[15px] text-faint hover:text-ink"
                >
                  ✎
                </button>
              </>
            )}
          </div>
          <div className="text-[13.5px] text-muted">{result.whenLabel}</div>
          <div className="mt-2 flex flex-col gap-1.5 text-left text-[13px]">
            {result.items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-sage-text">✓</span>
                <span>{it}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <Link href={`/clients/${result.clientId}`}>
              <OutlineButton>Open client</OutlineButton>
            </Link>
            <PrimaryButton onClick={() => router.push("/")}>Back to Today</PrimaryButton>
          </div>
        </Card>
      </div>
    );
  }

  /* ---------------- paste / inbox ---------------- */

  if (stage === "paste") {
    return (
      <div className="flex max-w-[1080px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
        <header>
          <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Enquiries</h1>
          <div className="mt-[5px] text-[13.5px] text-muted">
            Paste a message — details get picked out for you, nothing is sent without your say-so.
          </div>
        </header>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Inbox waiting={waiting} onOpen={(id) => void loadEnquiry(id)} />
          <Card className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-5">
            <SectionLabel>NEW ENQUIRY</SectionLabel>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the WhatsApp or email message here…"
              className="min-h-[140px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-sm leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
            />
            <PrimaryButton onClick={readMessage} disabled={reading} className="self-start">
              {reading ? "Reading…" : "Read message →"}
            </PrimaryButton>
          </Card>
        </div>
      </div>
    );
  }

  /* ---------------- book ---------------- */

  const otherWaiting = waiting.filter((q) => q.id !== enquiryId);
  const plan = selected ? planBookingEvents(clinic, (activeClient?.name || name || "New client").trim(), selected) : [];
  const isReturning = !!activeClient?.welcomeSent;

  return (
    <div className="flex max-w-[1200px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => {
            setAnalysis(null);
            setEnquiryId(null);
            setSelected(null);
            setSaved(existingClient ? { ...existingClient, saved: true } : null);
            setMatch(null);
            setText("");
          }}
          className="cursor-pointer text-[13.5px] font-semibold text-muted hover:text-clay-text"
        >
          ‹ Enquiries
        </button>
        {otherWaiting.length > 0 && (
          <div className="relative">
            <TintButton onClick={() => setShowWaitingList((v) => !v)}>
              {otherWaiting.length} more waiting ▾
            </TintButton>
            {showWaitingList && (
              <div className="absolute right-0 z-30 mt-1 w-[280px] overflow-hidden rounded-xl border border-line bg-card shadow-pop">
                {otherWaiting.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => {
                      setShowWaitingList(false);
                      void loadEnquiry(q.id);
                    }}
                    className="flex w-full cursor-pointer flex-col gap-0.5 px-3.5 py-2.5 text-left hover:bg-hoverbg"
                  >
                    <span className="text-[13px] font-semibold">{q.name || "Unknown"}</span>
                    <span className="line-clamp-1 text-[11.5px] text-muted">{q.text.trim()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      <Card className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setIgnoreMatch(false);
                }}
                disabled={!!saved}
                placeholder="Client name"
                className={`${inputClass} w-[220px] font-serif text-[16px] font-medium disabled:opacity-80`}
              />
              {saved ? (
                <span className="flex items-center gap-1.5">
                  <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">
                    CLIENT SAVED ✓
                  </Chip>
                  <Link
                    href={`/clients/${saved.id}`}
                    className="text-[12.5px] font-semibold text-sage-text hover:text-sage"
                  >
                    open ›
                  </Link>
                </span>
              ) : activeClient ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">
                    EXISTING — ONE RECORD KEPT
                  </Chip>
                  <Link
                    href={`/clients/${activeClient.id}`}
                    className="text-[12.5px] font-semibold text-sage-text hover:text-sage"
                  >
                    = {activeClient.name} ›
                  </Link>
                  <button
                    onClick={() => setIgnoreMatch(true)}
                    className="cursor-pointer text-[12px] text-muted underline hover:text-ink"
                  >
                    book as new instead
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Chip color="oklch(0.42 0.1 42)" bg="oklch(0.94 0.03 48)">
                    NEW CLIENT
                  </Chip>
                  {enquiryId && (
                    <OutlineButton className="px-3 py-1 text-[12px]" onClick={saveAsClient} disabled={saving}>
                      {saving ? "Saving…" : "Save as client"}
                    </OutlineButton>
                  )}
                </span>
              )}
            </div>
            <div className="text-[12.5px] text-muted">
              {[analysis?.phone, analysis?.email].filter(Boolean).join(" · ") ||
                (existingClient ? "Booking a returning client" : "No contact details found")}{" "}
              · 60 min session
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
                {CLINIC_LABEL[c]} · {c === "waterloo" ? "£80" : "£30–60"}
              </button>
            ))}
          </div>
        </div>
        {analysis?.clinicReason && (
          <div className="text-xs text-muted">Suggested: {analysis.clinicReason} — change it above if that&apos;s wrong.</div>
        )}
        {analysis?.requestedWhen && (
          <div className="text-xs text-muted">
            They asked for: <span className="font-semibold text-ink-soft">{analysis.requestedWhen}</span>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>
          PICK A SLOT — {CLINIC_LABEL[clinic]} · tap a green time
        </SectionLabel>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setWeekStart((w) => londonDayStart(-7, w));
              setSelected(null);
            }}
            className="cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-[13px] font-semibold hover:bg-hoverbg"
            aria-label="Previous week"
          >
            ‹
          </button>
          <button
            onClick={() => {
              setWeekStart(londonWeekStart());
              setSelected(null);
            }}
            className="cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-[12px] font-semibold hover:bg-hoverbg"
          >
            This week
          </button>
          <button
            onClick={() => {
              setWeekStart((w) => londonDayStart(7, w));
              setSelected(null);
            }}
            className="cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-[13px] font-semibold hover:bg-hoverbg"
            aria-label="Next week"
          >
            ›
          </button>
        </div>
      </div>

      {!spans ? (
        <div className="flex h-[220px] items-center justify-center rounded-2xl border border-line bg-card text-[13.5px] text-muted">
          Loading your calendar…
        </div>
      ) : (
        <>
          <TimeGrid
            weekStart={weekStart}
            spans={spans}
            mode="picker"
            picker={{ clinic, selected, onSelect: setSelected }}
          />
          <Legend variant="picker" />
        </>
      )}

      {selected && (
        <Card className="flex flex-col gap-3 border-[1.5px] border-clay/35 px-5 py-4">
          <div className="text-[14px] font-semibold">
            {fmtDayLong(selected)} · {fmtTime(selected)} — {CLINIC_LABEL[clinic]}
          </div>
          <SectionLabel>CALENDAR EVENTS TO CREATE</SectionLabel>
          <div className="flex flex-col gap-1.5 text-[13px]">
            {plan.map((ev, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-clay">•</span>
                <span>
                  &quot;{ev.summary}&quot; — {fmtTime(ev.start)}–{fmtTime(ev.end)} · reminders on
                </span>
              </div>
            ))}
          </div>

          <SectionLabel>CONFIRMATION EMAIL</SectionLabel>
          {isReturning && (
            <div className="text-[12.5px] text-muted">Returning client — just a short confirmation + the invite.</div>
          )}
          {!isReturning && (
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={sendPayment}
                onChange={(e) => {
                  setSendPayment(e.target.checked);
                  setEmailDirty(false);
                }}
              />
              New client — send payment details ({CLINIC_PRICE[clinic]})
            </label>
          )}
          <textarea
            value={emailBody}
            onChange={(e) => {
              setEmailBody(e.target.value);
              setEmailDirty(true);
            }}
            className={`${inputClass} min-h-[150px] resize-y leading-[1.55]`}
          />
          {emailDirty && (
            <button
              onClick={() => setEmailDirty(false)}
              className="cursor-pointer self-start text-[12px] font-semibold text-muted underline hover:text-ink"
            >
              Reset to template
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <OutlineButton onClick={() => setSelected(null)}>Change slot</OutlineButton>
            <PrimaryButton onClick={() => confirmBooking(true)} disabled={booking}>
              {booking ? "Booking…" : "Create events & send email"}
            </PrimaryButton>
            <OutlineButton onClick={() => confirmBooking(false)} disabled={booking}>
              Copy text & register — no email
            </OutlineButton>
          </div>
        </Card>
      )}

      {enquiryId && !selected && (
        <TintButton
          className="self-start"
          onClick={async () => {
            await api(`/api/enquiries/${enquiryId}/dismiss`, { method: "POST" });
            toast("Enquiry dismissed");
            void refreshWaiting();
            setAnalysis(null);
            setEnquiryId(null);
            setSaved(null);
            setMatch(null);
            setText("");
          }}
        >
          Dismiss enquiry
        </TintButton>
      )}
    </div>
  );
}
