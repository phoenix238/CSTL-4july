"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, CopyButton, inputClass, OutlineButton, PrimaryButton, SectionLabel, Sheet, useToast } from "@/components/ui";
import { BookSlotPicker } from "@/components/BookSlotPicker";
import { CLINIC_BOOKING_LABEL, CLINIC_LABEL, CLINIC_PRICE, type Clinic } from "@/lib/booking/rules";
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
  // Separate from `selected` on purpose. Picking a time opens the confirm box
  // over the page — the same treatment the first-booking flow gives it, rather
  // than a button that quietly appears at the bottom of the list. Closing the
  // box leaves the time highlighted so it can be reopened or swapped.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which session a move or cancel is aimed at — a client can hold more than one,
  // so the action has to name the exact booking rather than assume "the next one".
  const [targetId, setTargetId] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [receiptEmail, setReceiptEmail] = useState("");

  const upcoming = view.upcoming;
  // The session a reschedule is currently working on (its old time, its clinic).
  const target = upcoming.find((u) => u.id === targetId) ?? null;
  // The session whose cancel confirmation is open, if any.
  const cancelTarget = upcoming.find((u) => u.id === confirmingCancelId) ?? null;

  function reset() {
    setMode("idle");
    setSelected(null);
    setSheetOpen(false);
    setTargetId(null);
    setConfirmingCancelId(null);
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
          body: JSON.stringify({ startISO: selected, bookingId: targetId }),
        }),
      (r) => toast(`Moved to ${r.whenLabel}`),
    );

  const cancel = (bookingId: string) =>
    run(
      () =>
        api<{ whenLabel: string }>(`/api/portal/${token}/cancel`, {
          method: "POST",
          body: JSON.stringify({ bookingId }),
        }),
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

  // Reschedule keeps the client on their existing clinic; only a fresh booking
  // gets to choose one. This is the clinic the confirm box names either way.
  const pickerClinic = mode === "reschedule" && target ? target.clinic : clinic;

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
                setSheetOpen(false);
              }}
              className={`flex-1 cursor-pointer rounded-full px-3.5 py-2 text-[13px] font-semibold select-none ${
                clinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
              }`}
            >
              {CLINIC_BOOKING_LABEL[c]}
            </button>
          ))}
        </div>
      )}
      {mode === "book" && <div className="text-[12.5px] text-muted">{CLINIC_PRICE[clinic]} · 60 minutes</div>}

      {mode === "reschedule" && target && (
        <div className="rounded-lg bg-clay-tint px-3.5 py-2.5 text-[12.5px] text-clay-text">
          Your current time is{" "}
          <span className="font-semibold">
            {fmtDayLong(new Date(target.startsAtISO))}, {fmtTime(new Date(target.startsAtISO))}
          </span>
          . Pick a new time below.
        </div>
      )}

      <BookSlotPicker
        clinic={pickerClinic}
        selected={selected}
        onSelect={(iso) => {
          setSelected(iso);
          setSheetOpen(true);
        }}
        slotsUrl={(c) =>
          `/api/portal/${token}/slots?clinic=${c}${mode === "reschedule" ? "&moving=1" : ""}`
        }
        emptyMessage="No times free at the moment — please check back in a few days, or message Phoenix directly."
      />

      <div className="flex flex-wrap gap-2">
        <OutlineButton disabled={busy} onClick={reset}>
          Cancel
        </OutlineButton>
      </div>

      {/* Picking a time brings the confirm step forward over the page, matching
          the first-booking flow, instead of leaving it to be found at the foot
          of the list. Closing it keeps the time picked so it can be reopened. */}
      <Sheet
        open={sheetOpen}
        onClose={() => {
          if (!busy) setSheetOpen(false);
        }}
        label={mode === "book" ? "Confirm your booking" : "Move your session"}
      >
        {selected && (
          <div className="flex flex-col gap-4 px-5 py-5 pb-[calc(20px+env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-serif text-[19px] leading-tight font-medium">
                  {mode === "book" ? "Confirm your booking" : "Move your session"}
                </div>
                <div className="mt-1 text-[12.5px] text-muted">
                  {CLINIC_BOOKING_LABEL[pickerClinic]} · {fmtDayLong(new Date(selected))} at {fmtTime(new Date(selected))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                disabled={busy}
                aria-label="Close"
                className="-mt-1 -mr-1 shrink-0 cursor-pointer rounded-full px-2 py-1 text-[17px] leading-none text-muted hover:bg-hoverbg hover:text-ink disabled:cursor-default disabled:opacity-60"
              >
                ×
              </button>
            </div>

            {mode === "reschedule" && target && (
              <p className="text-[13px] leading-relaxed text-muted">
                This moves your session from{" "}
                <span className="font-semibold text-ink-soft">
                  {fmtDayLong(new Date(target.startsAtISO))}, {fmtTime(new Date(target.startsAtISO))}
                </span>{" "}
                to the new time above.
              </p>
            )}

            <PrimaryButton
              disabled={busy}
              onClick={mode === "book" ? bookNext : reschedule}
              className="py-3"
            >
              {busy ? "Saving…" : mode === "book" ? "Confirm booking" : "Move my session"}
            </PrimaryButton>
          </div>
        )}
      </Sheet>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-4 px-5 py-10">
      <header className="text-center">
        <h1 className="font-serif text-[28px] leading-[1.1]">Hi {view.firstName}</h1>
        <p className="mt-2 text-[13.5px] text-muted">Your sessions with Phoenix Tanner.</p>
      </header>

      {/* ---------- upcoming sessions ---------- */}
      <Card className="flex flex-col gap-3 px-5 py-5">
        <SectionLabel>{upcoming.length > 1 ? "Your upcoming sessions" : "Your next session"}</SectionLabel>
        {upcoming.length > 0 ? (
          <div className="flex flex-col gap-3">
            {upcoming.length > 1 && (
              <p className="text-[12.5px] text-muted">
                You have {upcoming.length} sessions coming up.
              </p>
            )}
            {upcoming.map((u, i) => (
              <div
                key={u.id}
                className={`flex flex-col gap-2 ${i > 0 ? "border-t border-hairline pt-3" : ""}`}
              >
                <div>
                  <div className="text-[15px] font-semibold">{fmtDayLong(new Date(u.startsAtISO))}</div>
                  <div className="text-[13px] text-muted">
                    {fmtTime(new Date(u.startsAtISO))} · {CLINIC_LABEL[u.clinic]}
                  </div>
                </div>

                {mode === "idle" && (
                  <div className="flex flex-wrap gap-2">
                    {u.canReschedule ? (
                      <OutlineButton
                        onClick={() => {
                          setMode("reschedule");
                          setTargetId(u.id);
                        }}
                      >
                        Move this session
                      </OutlineButton>
                    ) : (
                      <p className="text-[12.5px] leading-relaxed text-muted">
                        Sessions can be moved up to {view.noticeHours} hours beforehand. It&apos;s closer than that
                        now — message Phoenix and he&apos;ll sort something out.
                      </p>
                    )}
                    <OutlineButton onClick={() => setConfirmingCancelId(u.id)}>Cancel this session</OutlineButton>
                  </div>
                )}

                {mode === "reschedule" && targetId === u.id && picker}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">You don&apos;t have a session booked at the moment.</p>
        )}

        {/* Booking a session is always available while self-booking is on — a client
            can hold several at once (a course of sessions), so having one already
            never hides the button. Only the wording changes. */}
        {mode === "idle" &&
          (view.selfBookEnabled ? (
            <div>
              <PrimaryButton onClick={() => setMode("book")}>
                {upcoming.length > 0 ? "Book another session" : "Book my next session"}
              </PrimaryButton>
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              Message Phoenix whenever you&apos;d like to arrange your next one.
            </p>
          ) : null)}
        {mode === "book" && picker}

        {/* Same treatment as booking and moving: the confirm step — goodwill ask
            and all — comes forward over the page rather than unfolding beneath
            the buttons. The ask still appears BEFORE they commit, never after. One
            shared sheet, driven by which session's cancel was tapped. */}
        <Sheet
          open={!!cancelTarget}
          onClose={() => {
            if (!busy) setConfirmingCancelId(null);
          }}
          label="Cancel your session"
        >
          {cancelTarget && (
            <div className="flex flex-col gap-4 px-5 py-5 pb-[calc(20px+env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-serif text-[19px] leading-tight font-medium">Cancel your session</div>
                  <div className="mt-1 text-[12.5px] text-muted">
                    {fmtDayLong(new Date(cancelTarget.startsAtISO))} at {fmtTime(new Date(cancelTarget.startsAtISO))} ·{" "}
                    {CLINIC_LABEL[cancelTarget.clinic]}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmingCancelId(null)}
                  disabled={busy}
                  aria-label="Close"
                  className="-mt-1 -mr-1 shrink-0 cursor-pointer rounded-full px-2 py-1 text-[17px] leading-none text-muted hover:bg-hoverbg hover:text-ink disabled:cursor-default disabled:opacity-60"
                >
                  ×
                </button>
              </div>
              {cancelTarget.cancelGoodwillPence > 0 && (
                <p className="rounded-lg bg-clay-tint px-3.5 py-3 text-[12.5px] leading-relaxed text-clay-text">
                  This is inside {view.noticeHours} hours, so the room is already paid for. If you&apos;re able to, a{" "}
                  {formatPence(cancelTarget.cancelGoodwillPence)} contribution towards it is a real help. This is a
                  donation-based clinic though, so if that&apos;s too much right now, please don&apos;t pay it —
                  that&apos;s completely okay and nothing is owed either way.
                </p>
              )}
              <div className="flex flex-col gap-2.5">
                <PrimaryButton disabled={busy} onClick={() => cancel(cancelTarget.id)} className="py-3">
                  {busy ? "Cancelling…" : "Yes, cancel it"}
                </PrimaryButton>
                <OutlineButton disabled={busy} onClick={() => setConfirmingCancelId(null)}>
                  Keep my session
                </OutlineButton>
              </div>
            </div>
          )}
        </Sheet>
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
