"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, PrimaryButton, useToast } from "./ui";
import { formatPence } from "@/lib/account";
import { fmtDate } from "@/lib/time";

interface PendingTx {
  id: string;
  transactedAt: string;
  amountPence: number;
  reference: string;
  counterParty: string;
  status: string;
  clientId: string | null;
  /** a one-tap suggestion from the sender's name — never applied automatically */
  suggestedClientId?: string | null;
  suggestedClientName?: string | null;
}

export interface PaymentSettingsData {
  starlingEnabled: boolean;
  starlingAutoMark: boolean;
  starlingNotifyEmail: boolean;
  starlingLastSyncAt: string | null;
}

/**
 * Bank payment matching — switches, a manual check, and the queue of payments
 * that couldn't be placed automatically.
 *
 * The queue is the important half. Automatic matching handles the ordinary case;
 * what makes the feature trustworthy is that everything it *couldn't* place is
 * visible here rather than quietly dropped.
 */
export function PaymentMatching({
  initial,
  clients,
}: {
  initial: PaymentSettingsData;
  clients: Array<{ id: string; name: string; paymentRef: string }>;
}) {
  const toast = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingTx[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ configured: boolean; pending: PendingTx[] }>("/api/payments/sync");
      setConfigured(res.configured);
      setPending(res.pending);
    } catch {
      setConfigured(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const set = <K extends keyof PaymentSettingsData>(key: K, value: PaymentSettingsData[K]) => {
    setDraft((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          starlingEnabled: draft.starlingEnabled,
          starlingAutoMark: draft.starlingAutoMark,
          starlingNotifyEmail: draft.starlingNotifyEmail,
        }),
      });
      toast("Payment settings saved ✓");
      setDirty(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      const s = await api<{ newCount: number; matchedCount: number; unmatchedCount: number; ambiguousCount: number }>(
        "/api/payments/sync",
        { method: "POST", body: JSON.stringify({ force: true }) },
      );
      toast(
        s.newCount === 0
          ? "No new payments since last time"
          : `${s.newCount} new · ${s.matchedCount} matched · ${s.unmatchedCount + s.ambiguousCount} need a look`,
      );
      await load();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't reach the bank");
    } finally {
      setChecking(false);
    }
  }

  async function resolve(id: string, body: Record<string, unknown>, done: string) {
    setBusyId(id);
    try {
      await api(`/api/payments/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(done);
      await load();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 px-4 py-3.5">
        <div className="text-[13px] font-semibold text-ink">How it works</div>
        <p className="text-[12px] leading-[1.6] text-muted">
          Your bank feed is checked for money in, and each payment is matched to a client by the reference they used
          (<span className="font-mono">JS4</span> and so on). A match marks their oldest unpaid session as paid, and
          fills in the amount for sliding-scale sessions. Anything that doesn&apos;t match waits below for you.
        </p>
        {configured === false && (
          <p className="rounded-lg bg-clay-tint px-3.5 py-2.5 text-[12px] leading-[1.6] text-clay-text">
            No Starling token is set yet. Add <span className="font-mono">STARLING_TOKEN</span> to your environment
            variables in Vercel (a read-only personal access token is enough), then redeploy.
          </p>
        )}
        {draft.starlingLastSyncAt && (
          <div className="text-[11.5px] text-muted">
            Last checked {fmtDate(new Date(draft.starlingLastSyncAt))}
          </div>
        )}
        <div>
          <PrimaryButton onClick={checkNow} disabled={checking} className="px-4 py-1.5 text-[12.5px]">
            {checking ? "Checking…" : "Check for payments now"}
          </PrimaryButton>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 px-4 py-3.5">
        {(
          [
            [
              "starlingEnabled",
              "Check my bank automatically",
              "Runs on a schedule as well as when you press the button above.",
            ],
            [
              "starlingAutoMark",
              "Mark sessions paid automatically",
              "Turn off to collect and match payments but wait for you to apply each one.",
            ],
            [
              "starlingNotifyEmail",
              "Email me when payments come in",
              "One message per check, covering what matched and what didn't.",
            ],
          ] as const
        ).map(([key, label, hint]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => set(key, e.target.checked)}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[12.5px] font-medium text-ink">{label}</span>
              <span className="text-[11.5px] leading-[1.5] text-muted">{hint}</span>
            </span>
          </label>
        ))}
        <PrimaryButton onClick={save} disabled={!dirty || saving} className="self-start px-4 py-1.5 text-[12.5px]">
          {saving ? "Saving…" : "Save payment settings"}
        </PrimaryButton>
      </Card>

      {pending.length > 0 && (
        <Card className="flex flex-col gap-3 px-4 py-3.5">
          <div className="text-[13px] font-semibold text-ink">
            {pending.length} payment{pending.length === 1 ? "" : "s"} to place
          </div>
          {pending.map((tx) => (
            <div key={tx.id} className="flex flex-col gap-1.5 border-t border-hairline pt-2.5 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="font-semibold">{formatPence(tx.amountPence)}</span>
                <span className="text-[11.5px] text-muted">{fmtDate(new Date(tx.transactedAt))}</span>
              </div>
              <div className="text-[11.5px] text-muted">
                From {tx.counterParty || "unknown"} · reference{" "}
                <span className="font-mono">{tx.reference || "none given"}</span>
                {tx.status === "ambiguous" && " · matched more than one client"}
              </div>
              {tx.suggestedClientId && tx.suggestedClientName && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sage-tint px-2.5 py-1.5 text-[12px] text-sage-text">
                  <span>
                    Looks like <span className="font-semibold">{tx.suggestedClientName}</span>?
                  </span>
                  <button
                    onClick={() =>
                      resolve(tx.id, { clientId: tx.suggestedClientId }, `Assigned to ${tx.suggestedClientName} ✓`)
                    }
                    disabled={busyId === tx.id}
                    className="cursor-pointer rounded-full bg-sage px-2.5 py-0.5 text-[11.5px] font-semibold text-cream hover:opacity-90 disabled:cursor-default"
                  >
                    Confirm
                  </button>
                  <span className="text-[11px] text-muted">or choose below</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  defaultValue={tx.suggestedClientId ?? ""}
                  onChange={(e) => {
                    if (e.target.value) resolve(tx.id, { clientId: e.target.value }, "Payment assigned ✓");
                  }}
                  disabled={busyId === tx.id}
                  className="max-w-[190px] rounded-lg border border-inputline bg-inputbg px-2 py-1 text-[12px] text-ink"
                >
                  <option value="">Assign to…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.paymentRef ? ` (${c.paymentRef})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => resolve(tx.id, { ignore: true }, "Set aside")}
                  disabled={busyId === tx.id}
                  className="cursor-pointer text-[11.5px] font-semibold text-muted hover:text-ink-soft disabled:cursor-default"
                >
                  Not a session payment
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
