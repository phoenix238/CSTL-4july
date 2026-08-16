"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, CopyButton, inputClass, OutlineButton, PrimaryButton, SectionLabel, useToast } from "@/components/ui";
import { BookSlotPicker } from "@/components/BookSlotPicker";
import { CLINIC_LABEL, CLINIC_PRICE, type Clinic } from "@/lib/booking/rules";
import { formatPence, sessionPriceLabel } from "@/lib/account";
import { fmtDayLong, fmtTime } from "@/lib/time";
import type { PortalView } from "@/lib/portalData";

/**
 * The client's own page. Everything they can do with their sessions, and nothing
 * about anyone else's — no wider schedule, no other names, no admin surface.
 */
export function ClientPortal({ token, view }: { token: string; view: PortalView }) {
  const toast = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<"idle" | "book" | "reschedule">("idle");
  const [clinic, setClinic] = useState<Clinic>(view.preferredClinic);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");

  const upcoming = view.upcoming;

  function reset() {
    setMode("idle");
    setSelected(null);
    setConfirmingCancel(false);
  }

  /** Run a portal action, then refresh the server-rendered view so it can't go stale. */
  async function run<T>(fn: () => Promise<T>, onDone: (result: T) => void) {
    setBusy(true);
    try {
      onDone(await fn());
      reset();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong — please try again");
    } finally {
      setBusy(false);
    }
  }

  async function copyField(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied ✓`);
    } catch {
      toast("Couldn't copy — try again");
    }
  }

  const bookNext = () =>
    run(
      () =>
        api<{ whenLabel: string }>(`/api/portal/${token}/book`, {
          method: "POST",
          body: JSON.stringify({ clinic, startISO: selected }),
        }),
      (r) => toast(`Booked — ${r.whenLabel}`),
    );

  const reschedule = () =>
    run(
      () =>
        api<{ whenLabel: string }>(`/api/portal/${token}/reschedule`, {
          method: "POST",
          body: JSON.stringify({ startISO: selected }),
        }),
      (r) => toast(`Moved to ${r.whenLabel}`),
    );

  const cancel = () =>
    run(
      () => api<{ whenLabel: string }>(`/api/portal/${token}/cancel`, { method: "POST" }),
      () => toast("Your session has been cancelled"),
    );

  const receiptToast = (r: { sentTo?: string; pending?: boolean }) =>
    toast(r.pending ? "Got it — we'll email your receipt as soon as a payment is confirmed." : `Receipt sent to ${r.sentTo}`);

  const requestReceipt = () =>
    run(() => api<{ sentTo?: string; pending?: boolean }>(`/api/portal/${token}/receipt`, { method: "POST" }), receiptToast);

  const addEmailAndSendReceipt = () =>
    run(async () => {
      await api(`/api/portal/${token}/email`, {
        method: "POST",
        body: JSON.stringify({ email: receiptEmail }),
      });
      return api<{ sentTo?: string; pending?: boolean }>(`/api/portal/${token}/receipt`, { method: "POST" });
    }, receiptToast);

  const picker = (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      {mode === "book" && (
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
      )}
      {mode === "book" && <div className="text-[12.5px] text-muted">{CLINIC_PRICE[clinic]} · 60 minutes</div>}

      {mode === "reschedule" && upcoming && (
        <div className="rounded-lg bg-clay-tint px-3.5 py-2.5 text-[12.5px] text-clay-text">
          Your current time is{" "}
          <span className="font-semibold">
            {fmtDayLong(new Date(upcoming.startsAtISO))}, {fmtTime(new Date(upcoming.startsAtISO))}
          </span>
          . Pick a new time below.
        </div>
      )}

      <BookSlotPicker
        clinic={mode === "reschedule" && upcoming ? upcoming.clinic : clinic}
        selected={selected}
        onSelect={setSelected}
        slotsUrl={(c) =>
          `/api/portal/${token}/slots?clinic=${c}${mode === "reschedule" ? "&moving=1" : ""}`
        }
        emptyMessage="No times free at the moment — please check back in a few days, or message Phoenix directly."
      />

      <div className="flex flex-wrap gap-2">
        <PrimaryButton
          disabled={!selected || busy}
          onClick={mode === "book" ? bookNext : reschedule}
        >
          {busy ? "Saving…" : mode === "book" ? "Confirm booking" : "Move my session"}
        </PrimaryButton>
        <OutlineButton disabled={busy} onClick={reset}>
          Cancel
        </OutlineButton>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-4 px-5 py-10">
      <header className="text-center">
        <h1 className="font-serif text-[28px] leading-[1.1]">Hi {view.firstName}</h1>
        <p className="mt-2 text-[13.5px] text-muted">Your sessions with Phoenix Tanner.</p>
      </header>

      {/* ---------- next session ---------- */}
      <Card className="flex flex-col gap-3 px-5 py-5">
        <SectionLabel>Your next session</SectionLabel>
        {upcoming ? (
          <>
            <div>
              <div className="text-[15px] font-semibold">{fmtDayLong(new Date(upcoming.startsAtISO))}</div>
              <div className="text-[13px] text-muted">
                {fmtTime(new Date(upcoming.startsAtISO))} · {CLINIC_LABEL[upcoming.clinic]}
              </div>
            </div>

            {mode === "idle" && !confirmingCancel && (
              <div className="flex flex-wrap gap-2">
                {upcoming.canReschedule ? (
                  <OutlineButton onClick={() => setMode("reschedule")}>Move this session</OutlineButton>
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-muted">
                    Sessions can be moved up to {view.noticeHours} hours beforehand. It&apos;s closer than that now —
                    message Phoenix and he&apos;ll sort something out.
                  </p>
                )}
                <OutlineButton onClick={() => setConfirmingCancel(true)}>Cancel this session</OutlineButton>
              </div>
            )}

            {/* The goodwill ask appears BEFORE they commit, never as a surprise after. */}
            {confirmingCancel && (
              <div className="flex flex-col gap-3 border-t border-hairline pt-4">
                <p className="text-[13px] leading-relaxed">
                  Cancel your session on {fmtDayLong(new Date(upcoming.startsAtISO))}?
                </p>
                {upcoming.cancelGoodwillPence > 0 && (
                  <p className="rounded-lg bg-clay-tint px-3.5 py-3 text-[12.5px] leading-relaxed text-clay-text">
                    This is inside {view.noticeHours} hours, so the room is already paid for. If you&apos;re able to, a{" "}
                    {formatPence(upcoming.cancelGoodwillPence)} contribution towards it is a real help. This is a
                    donation-based clinic though, so if that&apos;s too much right now, please don&apos;t pay it —
                    that&apos;s completely okay and nothing is owed either way.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton disabled={busy} onClick={cancel}>
                    {busy ? "Cancelling…" : "Yes, cancel it"}
                  </PrimaryButton>
                  <OutlineButton disabled={busy} onClick={() => setConfirmingCancel(false)}>
                    Keep my session
                  </OutlineButton>
                </div>
              </div>
            )}

            {mode === "reschedule" && picker}
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted">You don&apos;t have a session booked at the moment.</p>
            {mode === "idle" &&
              (view.selfBookEnabled ? (
                <div>
                  <PrimaryButton onClick={() => setMode("book")}>Book my next session</PrimaryButton>
                </div>
              ) : (
                <p className="text-[12.5px] text-muted">
                  Message Phoenix whenever you&apos;d like to arrange your next one.
                </p>
              ))}
            {mode === "book" && picker}
          </>
        )}
      </Card>

      {/* ---------- payment ---------- */}
      <Card className="flex flex-col gap-3 px-5 py-5">
        <SectionLabel>Payment</SectionLabel>

        <details className="group flex flex-col">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-clay-text [&::-webkit-details-marker]:hidden">
            <span>Payment details &amp; your reference</span>
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              className="size-4 shrink-0 text-clay-text transition-transform group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 7.5l5 5 5-5" />
            </svg>
          </summary>
          <div className="mt-3 flex flex-col gap-3">

        <div className="rounded-lg bg-clay-tint px-3.5 py-3">
          <div className="text-[12px] font-semibold text-clay-text">Your payment reference</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="font-mono text-[20px] font-semibold tracking-wide text-clay-text">
              {view.paymentRef}
            </div>
            <CopyButton onClick={() => copyField("Reference", view.paymentRef)} />
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-clay-text">
            Please use this as the reference on every transfer — it&apos;s how Phoenix matches your payment to you.
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-clay-text">
            Payments are checked once a day, so it can take up to 24 hours to show here as confirmed.
          </p>
        </div>

        {view.hasBankDetails && (
          <dl className="flex flex-col gap-1.5 text-[13px]">
            {view.bank.accountName && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Account name</dt>
                <dd className="flex items-center gap-1 font-medium">
                  {view.bank.accountName}
                  <CopyButton onClick={() => copyField("Account name", view.bank.accountName)} />
                </dd>
              </div>
            )}
            {view.bank.sortCode && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Sort code</dt>
                <dd className="flex items-center gap-1 font-mono font-medium">
                  {view.bank.sortCode}
                  <CopyButton onClick={() => copyField("Sort code", view.bank.sortCode)} />
                </dd>
              </div>
            )}
            {view.bank.accountNumber && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Account number</dt>
                <dd className="flex items-center gap-1 font-mono font-medium">
                  {view.bank.accountNumber}
                  <CopyButton onClick={() => copyField("Account number", view.bank.accountNumber)} />
                </dd>
              </div>
            )}
          </dl>
        )}
        {view.bank.note && (
          <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-muted">{view.bank.note}</p>
        )}
          </div>
        </details>

        <div className="flex flex-col gap-1 border-t border-hairline pt-3 text-[13px]">
          <div className="flex justify-between gap-4">
            <span className="text-muted">Sessions paid for</span>
            <span className="font-medium">
              {view.account.paidCount} of {view.account.completedCount}
            </span>
          </div>
          {view.account.balancePence > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-muted">Outstanding</span>
              <span className="font-semibold">{formatPence(view.account.balancePence)}</span>
            </div>
          )}
          {/* Sliding-scale sessions have no set figure, so they're named rather than
              rolled into a total that would understate what's outstanding. */}
          {view.account.unpricedCount > 0 && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              {view.account.unpricedCount} sliding-scale{" "}
              {view.account.unpricedCount === 1 ? "session is" : "sessions are"} shown without an amount — pay whatever
              felt right for {view.account.unpricedCount === 1 ? "it" : "them"}.
            </p>
          )}
          {view.account.goodwillPence > 0 && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Plus an optional {formatPence(view.account.goodwillPence)} towards a short-notice cancellation — a
              contribution, not a charge.
            </p>
          )}
        </div>

        {view.receiptsEnabled &&
          (view.hasEmail ? (
            <div className="flex flex-col gap-1.5">
              <div>
                <OutlineButton disabled={busy} onClick={requestReceipt}>
                  {view.receiptPending ? "Check for a receipt" : "Email me a receipt"}
                </OutlineButton>
              </div>
              <p className="text-[12px] leading-relaxed text-muted">
                {view.receiptPending
                  ? "We'll email it automatically as soon as a payment is confirmed — no need to ask again."
                  : "You can request this any time, including for a copy of an earlier receipt."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] leading-relaxed text-muted">
                No email on file yet — add one to get a receipt sent to you.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={receiptEmail}
                  onChange={(e) => setReceiptEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <OutlineButton disabled={busy || !receiptEmail.trim()} onClick={addEmailAndSendReceipt}>
                  Send receipt
                </OutlineButton>
              </div>
            </div>
          ))}
      </Card>

      {/* ---------- history ---------- */}
      {view.history.length > 0 && (
        <Card className="flex flex-col gap-3 px-5 py-5">
          <SectionLabel>Your sessions</SectionLabel>
          <ul className="flex flex-col gap-2">
            {view.history.map((s) => {
              const d = new Date(s.startsAtISO);
              return (
                <li key={s.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                  <span className={s.cancelled ? "text-muted line-through" : ""}>
                    {fmtDayLong(d)}
                    <span className="ml-1.5 text-[12px] text-muted">{CLINIC_LABEL[s.clinic]}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">
                    {s.cancelled
                      ? "Cancelled"
                      : s.paid
                        ? `Paid${s.amountPence != null ? ` · ${formatPence(s.amountPence)}` : ""}`
                        : sessionPriceLabel(s.clinic, s.amountPence)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <p className="px-2 pb-4 text-center text-[11.5px] leading-relaxed text-muted">
        This page is just for you — keep the link handy and you can come back to it any time.
      </p>
    </div>
  );
}
