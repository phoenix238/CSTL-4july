"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, SectionLabel, useToast } from "./ui";
import { formatPence, sessionPriceLabel, summariseAccount, type AccountBooking } from "@/lib/account";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { fmtDate } from "@/lib/time";

export interface AccountRow {
  id: string;
  startsAtISO: string;
  clinic: string;
  status: string;
  paid: boolean;
  amountPence: number | null;
  goodwillPence: number;
  goodwillReason: string;
  goodwillSettled: boolean;
  goodwillWaived: boolean;
}

/**
 * Phoenix's side of the client portal: the link to send them, their payment
 * reference, and one-tap payment ticking.
 *
 * The ticking is deliberately one tap. The client's page shows "unpaid" straight
 * from this data, so anything that makes marking a session paid a chore turns
 * into a client looking at a wrong balance and messaging about it.
 */
export function ClientAccountPanel({
  clientId,
  clientName,
  hasEmail,
  paymentRef,
  bookings,
}: {
  clientId: string;
  clientName: string;
  hasEmail: boolean;
  paymentRef: string;
  bookings: AccountRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const account = summariseAccount(
    bookings.map((b): AccountBooking => ({ ...b, startsAt: new Date(b.startsAtISO) })),
  );

  async function patch(bookingId: string, body: Record<string, unknown>, done: string) {
    setBusyId(bookingId);
    try {
      await api(`/api/bookings/${bookingId}/payment`, { method: "PATCH", body: JSON.stringify(body) });
      toast(done);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink() {
    try {
      const { url } = await api<{ url: string; paymentRef: string }>(`/api/clients/${clientId}/portal-link`);
      await navigator.clipboard?.writeText(url);
      toast("Client page link copied ✓");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't get the link");
    }
  }

  async function emailLink() {
    setSending(true);
    try {
      const { sentTo } = await api<{ sentTo: string }>(`/api/clients/${clientId}/portal-link`, { method: "POST" });
      toast(`Booking page sent to ${sentTo} ✓`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setSending(false);
    }
  }

  async function emailReceipt() {
    setSendingReceipt(true);
    try {
      const { sentTo, count } = await api<{ sentTo: string; count: number }>(`/api/clients/${clientId}/receipt`, {
        method: "POST",
      });
      toast(`Receipt for ${count} ${count === 1 ? "session" : "sessions"} sent to ${sentTo} ✓`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setSendingReceipt(false);
    }
  }

  // Past and cancelled sessions, newest first — the ones with money attached.
  const now = Date.now();
  const relevant = bookings
    .filter((b) => new Date(b.startsAtISO).getTime() <= now || b.goodwillPence > 0)
    .sort((a, b) => new Date(b.startsAtISO).getTime() - new Date(a.startsAtISO).getTime());
  const shown = showAll ? relevant : relevant.slice(0, 5);

  const first = clientName.split(" ")[0];

  return (
    <>
      <SectionLabel className="pt-2">PAYMENTS &amp; CLIENT PAGE</SectionLabel>
      <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-card px-4 py-[13px]">
        <div className="flex flex-col gap-1 text-[12.5px]">
          <div className="flex justify-between gap-3">
            <span className="text-muted">Paid</span>
            <span className="font-semibold">
              {account.paidCount} of {account.completedCount} sessions
            </span>
          </div>
          {account.balancePence > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Outstanding</span>
              <span className="font-semibold text-[oklch(0.55_0.12_25)]">{formatPence(account.balancePence)}</span>
            </div>
          )}
          {account.unpricedCount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Amount not set</span>
              <span className="font-semibold">{account.unpricedCount}</span>
            </div>
          )}
          {account.goodwillPence > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Goodwill offered</span>
              <span className="font-semibold">{formatPence(account.goodwillPence)}</span>
            </div>
          )}
          {paymentRef && (
            <div className="flex justify-between gap-3">
              <span className="text-muted">Reference</span>
              <span className="font-mono font-semibold">{paymentRef}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-hairline pt-2.5">
          <button
            onClick={copyLink}
            className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-hoverbg"
          >
            Copy page link
          </button>
          <button
            onClick={emailLink}
            disabled={sending || !hasEmail}
            title={hasEmail ? undefined : "No email address on this client's record yet"}
            className="cursor-pointer rounded-full bg-clay-tint px-3.5 py-1.5 text-[12px] font-semibold text-clay-text disabled:cursor-default disabled:opacity-50"
          >
            {sending ? "Sending…" : `Email page to ${first}`}
          </button>
          {/* Always a deliberate action — nothing is receipted automatically. */}
          <button
            onClick={emailReceipt}
            disabled={sendingReceipt || !hasEmail || account.paidCount === 0}
            title={
              account.paidCount === 0
                ? "No sessions marked as paid yet"
                : hasEmail
                  ? undefined
                  : "No email address on this client's record yet"
            }
            className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-hoverbg disabled:cursor-default disabled:opacity-50"
          >
            {sendingReceipt ? "Sending…" : "Email receipt"}
          </button>
        </div>

        {shown.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-2.5">
            {shown.map((b) => {
              const cancelled = b.status === "cancelled";
              const openGoodwill = b.goodwillPence > 0 && !b.goodwillSettled && !b.goodwillWaived;
              return (
                <div key={b.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className={cancelled ? "text-muted line-through" : ""}>
                      {fmtDate(new Date(b.startsAtISO))}
                      <span className="ml-1.5 text-[11px] text-muted">{CLINIC_LABEL[b.clinic as Clinic]}</span>
                    </span>
                    {!cancelled && (
                      <button
                        onClick={() =>
                          patch(b.id, { paid: !b.paid }, b.paid ? "Marked unpaid" : "Marked paid ✓")
                        }
                        disabled={busyId === b.id}
                        className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-semibold disabled:cursor-default disabled:opacity-50 ${
                          b.paid
                            ? "bg-clay-tint text-clay-text"
                            : "border border-line text-[oklch(0.55_0.12_25)] hover:bg-hoverbg"
                        }`}
                      >
                        {busyId === b.id
                          ? "…"
                          : b.paid
                            ? `Paid${b.amountPence != null ? ` · ${formatPence(b.amountPence)}` : ""}`
                            : "Mark paid"}
                      </button>
                    )}
                  </div>
                  {openGoodwill && (
                    <div className="flex items-center justify-between gap-2 pl-1 text-[11px] text-muted">
                      <span>
                        {formatPence(b.goodwillPence)} goodwill offered
                        {b.goodwillReason === "no_show" ? " (no-show)" : " (short notice)"}
                      </span>
                      <span className="flex gap-1.5">
                        <button
                          onClick={() => patch(b.id, { goodwillSettled: true }, "Marked as given ✓")}
                          disabled={busyId === b.id}
                          className="cursor-pointer font-semibold text-clay-text hover:text-clay disabled:cursor-default"
                        >
                          Given
                        </button>
                        <button
                          onClick={() => patch(b.id, { goodwillWaived: true }, "Waived")}
                          disabled={busyId === b.id}
                          className="cursor-pointer font-semibold text-muted hover:text-ink-soft disabled:cursor-default"
                        >
                          Waive
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {relevant.length > shown.length && (
              <button
                onClick={() => setShowAll(true)}
                className="cursor-pointer self-start pt-0.5 text-[11.5px] font-semibold text-clay-text hover:text-clay"
              >
                Show all {relevant.length}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
