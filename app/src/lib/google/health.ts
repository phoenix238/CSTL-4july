import { google } from "googleapis";
import { prisma, getSettings } from "@/lib/db";
import { getOAuthClient } from "./client";

/**
 * Whether the Google connection actually works — as opposed to whether a
 * refresh token happens to be stored.
 *
 * The old indicator was `!!googleRefreshToken`: a green tick the moment any
 * string sat in that column, regardless of whether the token still refreshed,
 * whether consent had been withdrawn, or whether the scope the app needs was
 * ever granted. That's how "✓ Connected — Drive · Calendar · Gmail" and "Google
 * needs reconnecting" ended up on screen at the same time, with nothing
 * anywhere saying what Google had actually objected to.
 *
 * This checks the three things that can independently be wrong, in the order
 * they fail:
 *   1. is there a token at all
 *   2. does it still exchange for an access token (revoked / expired / wrong
 *      OAuth client credentials)
 *   3. does the scope the failing feature needs appear in what was granted, and
 *      does Gmail actually answer for this account
 */

/** Every scope the app asks for, with what breaks when it's missing. */
export const REQUIRED_SCOPES: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.send": "Sending email",
  "https://www.googleapis.com/auth/calendar": "Calendar events",
  "https://www.googleapis.com/auth/drive": "Client folders in Drive",
  "https://www.googleapis.com/auth/documents": "Session notes in Google Docs",
  "https://www.googleapis.com/auth/spreadsheets": "The marketing spreadsheet",
};

export interface GoogleHealth {
  ok: boolean;
  /** the Gmail address the app is sending as, once Gmail has confirmed it */
  sendingAs?: string;
  /** granted scopes that are missing — reconnecting is the fix */
  missingScopes: string[];
  /** what Google actually said, verbatim — never hidden behind friendly wording */
  error?: string;
  /** the one thing to do about it, in Phoenix's language */
  fix?: string;
  checkedAt: string;
}

const RECONNECT_FIX =
  "Open Settings › Behind the scenes and tap “Reconnect Google”. Sign in as the account you send email from, and tick every permission on the consent screen — leaving one unticked is what causes this.";

/**
 * Google's own error text, dug out of whatever shape the client throws.
 *
 * googleapis wraps failures differently depending on where they happen: a token
 * refresh throws `{ response: { data: { error, error_description } } }`, an API
 * call throws a GaxiosError whose `errors[0].message` carries the real reason,
 * and a network failure is a plain Error. All three matter here, because the
 * message is the only thing that distinguishes "reconnect" from "this will
 * never work until you change something in Google Cloud".
 */
export function googleErrorMessage(err: unknown): string {
  const e = err as {
    message?: string;
    response?: { data?: { error?: string | { message?: string }; error_description?: string } };
    errors?: Array<{ message?: string }>;
  };
  const data = e?.response?.data;
  const dataError = typeof data?.error === "string" ? data.error : data?.error?.message;
  return (
    [dataError, data?.error_description].filter(Boolean).join(" — ") ||
    e?.errors?.[0]?.message ||
    e?.message ||
    String(err)
  );
}

/**
 * Turn Google's error into the specific thing to do about it.
 *
 * Deliberately more than one answer. "Reconnect Google" is the right advice for
 * a withdrawn or scope-short consent and useless for everything else — and
 * being told to reconnect, reconnecting, and watching it fail identically is
 * exactly the loop this is here to end.
 */
export function googleFixFor(message: string): string {
  const m = message.toLowerCase();
  if (/insufficient (authentication scopes|permission)|access.*denied|forbidden/.test(m)) {
    return RECONNECT_FIX;
  }
  if (/invalid_grant|token has been expired or revoked|invalid credentials|unauthorized/.test(m)) {
    return (
      "Google has stopped accepting the saved connection — usually because consent was withdrawn, or because the OAuth consent screen is still in “Testing” mode, where Google expires the connection after 7 days. " +
      RECONNECT_FIX +
      " If it keeps dropping every week, publish the consent screen in Google Cloud › APIs & Services › OAuth consent screen."
    );
  }
  if (/invalid_client|unauthorized_client|client.*not found/.test(m)) {
    return "Google is rejecting the app's own credentials, so reconnecting won't help. Check AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in the deployment's environment variables still match the OAuth client in Google Cloud — this is what you see after the client secret is rotated or the OAuth client is deleted.";
  }
  if (/gmail api has not been used|api .*disabled|accessnotconfigured/.test(m)) {
    return "The Gmail API is switched off for this Google Cloud project. Enable it at Google Cloud › APIs & Services › Library › Gmail API, then try again.";
  }
  if (/precondition|mail service not enabled|failedprecondition/.test(m)) {
    return "This Google account has no Gmail mailbox to send from. Sign in with the Google account that actually has your email on it.";
  }
  if (/quota|rate limit|too many/.test(m)) {
    return "Google is rate-limiting the account. Wait a few minutes and try again — nothing is broken.";
  }
  return "Try again; if it keeps happening, reconnect Google from Settings › Behind the scenes.";
}

/** Record that a Google call worked — clears whatever error was last shown. */
export async function recordGoogleSuccess(): Promise<void> {
  try {
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { googleLastError: "", googleLastCheckedAt: new Date() },
    });
  } catch {
    /* status bookkeeping must never fail the thing it's reporting on */
  }
}

/** Record what Google refused, so the indicator and Settings can show it. */
export async function recordGoogleFailure(err: unknown): Promise<void> {
  try {
    await prisma.appSettings.update({
      where: { id: 1 },
      // Truncated: this is displayed in a small status line, and Google's
      // longer HTML-ish errors would otherwise fill the settings panel.
      data: { googleLastError: googleErrorMessage(err).slice(0, 500), googleLastCheckedAt: new Date() },
    });
  } catch {
    /* as above */
  }
}

/**
 * Actually exercise the connection: refresh the token, ask Gmail who we are,
 * and compare the granted scopes against what the app needs.
 *
 * Writes the result to settings so the sidebar indicator can tell the truth
 * without every page load making Google API calls.
 */
export async function checkGoogleHealth(): Promise<GoogleHealth> {
  const checkedAt = new Date();
  const settings = await getSettings();
  const base = { missingScopes: [] as string[], checkedAt: checkedAt.toISOString() };

  if (!settings.googleRefreshToken) {
    return {
      ...base,
      ok: false,
      error: "No Google account is connected yet.",
      fix: "Open Settings › Behind the scenes and tap “Reconnect Google”.",
    };
  }

  // Scopes are recorded at consent time. An older connection predates that
  // record, so an empty string means "unknown", not "none granted" — reporting
  // every scope as missing there would be a confident lie.
  const granted = settings.googleScopes.trim() ? settings.googleScopes.split(/\s+/) : null;
  const missingScopes = granted ? Object.keys(REQUIRED_SCOPES).filter((s) => !granted.includes(s)) : [];

  try {
    const auth = await getOAuthClient();
    // Step 1: does the refresh token still exchange? This is where a revoked or
    // expired grant fails, and it fails the same way for every feature — which
    // is why it's checked before anything Gmail-specific.
    await auth.getAccessToken();
    // Step 2: does Gmail answer for this account? Catches an API that isn't
    // enabled, an account with no mailbox, and a missing gmail.send scope.
    const gmail = google.gmail({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });

    if (missingScopes.length) {
      const label = missingScopes.map((s) => REQUIRED_SCOPES[s]).join(", ");
      const error = `Connected, but Google didn't grant: ${label}.`;
      await prisma.appSettings.update({
        where: { id: 1 },
        data: { googleLastError: error, googleLastCheckedAt: checkedAt },
      });
      return {
        ...base,
        ok: false,
        sendingAs: profile.data.emailAddress ?? undefined,
        missingScopes,
        error,
        fix: RECONNECT_FIX,
      };
    }

    await recordGoogleSuccess();
    return { ...base, ok: true, sendingAs: profile.data.emailAddress ?? undefined };
  } catch (err) {
    const error = googleErrorMessage(err);
    await recordGoogleFailure(err);
    return { ...base, ok: false, missingScopes, error, fix: googleFixFor(error) };
  }
}
