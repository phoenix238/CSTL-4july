"use client";

import { useState } from "react";
import { api, Card, PrimaryButton } from "./ui";
import { reconnectGoogle } from "@/lib/googleActions";

interface Health {
  ok: boolean;
  sendingAs?: string;
  missingScopes: string[];
  error?: string;
  fix?: string;
  checkedAt: string;
}

/**
 * The Google connection, told honestly.
 *
 * This panel replaced a line that read "✓ Connected — Drive · Calendar · Gmail"
 * whenever a refresh token existed, regardless of whether Google would accept
 * it. That line was on screen at the same time as "Google needs reconnecting",
 * which is how reconnecting became something to do repeatedly and hopefully.
 *
 * So: one button that actually calls Gmail, and an answer that says what
 * Google said and what to do about it — including the cases where reconnecting
 * is not the fix and never will be.
 */
export function GoogleConnectionPanel({
  connected,
  lastError,
}: {
  connected: boolean;
  /** the last failure recorded by a real send, "" if the last one worked */
  lastError: string;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      setHealth(await api<Health>("/api/google/health"));
    } catch (err) {
      setHealth({
        ok: false,
        missingScopes: [],
        error: err instanceof Error ? err.message : "The check itself couldn't run.",
        fix: "Reload the page and try again.",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setChecking(false);
    }
  }

  // Before the check is run, the panel reports what the app last observed for
  // itself rather than guessing — a recorded failure is evidence, an absence of
  // one is not proof that everything works.
  const state: "ok" | "failing" | "off" = !connected ? "off" : (health ? health.ok : !lastError) ? "ok" : "failing";
  const message = health?.error || lastError;
  const tone =
    state === "ok"
      ? "text-sage-text"
      : state === "failing"
        ? "text-amber-text"
        : "text-[oklch(0.52_0.15_30)]";

  return (
    <Card className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[12.5px] font-semibold ${tone}`}>
          {state === "ok" && (health?.ok ? "✓ Working — Google accepted a live check" : "Connected — no recent failures")}
          {state === "failing" && "Connected, but Google is refusing us"}
          {state === "off" && "Not connected"}
        </span>
        <button
          onClick={check}
          disabled={checking}
          className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-clay-text hover:bg-hoverbg disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check connection now"}
        </button>
      </div>

      {health?.sendingAs && (
        <div className="text-[12px] text-muted">
          Sending email as <span className="font-semibold text-ink-soft">{health.sendingAs}</span>
        </div>
      )}

      {!!health?.missingScopes.length && (
        <div className="text-[12px] leading-[1.55] text-amber-text">
          Google didn&apos;t grant everything the app asked for. Reconnect and tick every box on the consent screen.
        </div>
      )}

      {message && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-inputbg px-3.5 py-3">
          <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
            WHAT GOOGLE SAID
          </span>
          {/* Verbatim, deliberately. Friendly paraphrasing is what made this
              impossible to diagnose from a phone in the first place. */}
          <code className="text-[11.5px] leading-[1.5] break-words text-ink-soft">{message}</code>
          {health?.fix && <p className="mt-1 text-[12px] leading-[1.55] text-muted">{health.fix}</p>}
        </div>
      )}

      <form action={reconnectGoogle}>
        <PrimaryButton type="submit" className="px-[18px] py-[9px] text-[13px]">
          Reconnect Google
        </PrimaryButton>
        <p className="mt-2 text-[11px] leading-[1.5] text-muted">
          Sign in as the account you send email from, and tick <em>every</em> permission on the consent screen —
          leaving one unticked looks exactly like a healthy connection until something fails.
        </p>
      </form>
    </Card>
  );
}
