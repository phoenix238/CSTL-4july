import { google } from "googleapis";
import { getSettings } from "@/lib/db";
import type { CalendarKey } from "@/lib/booking/rules";

/** OAuth2 client backed by the stored refresh token (Phoenix's account). */
export async function getOAuthClient() {
  const settings = await getSettings();
  if (!settings.googleRefreshToken) {
    throw new Error("Google is not connected yet — sign in with Google from the app first.");
  }
  const client = new google.auth.OAuth2(
    process.env.AUTH_GOOGLE_ID,
    process.env.AUTH_GOOGLE_SECRET,
  );
  client.setCredentials({ refresh_token: settings.googleRefreshToken });
  return client;
}

export async function getCalendarApi() {
  return google.calendar({ version: "v3", auth: await getOAuthClient() });
}
export async function getDriveApi() {
  return google.drive({ version: "v3", auth: await getOAuthClient() });
}
export async function getDocsApi() {
  return google.docs({ version: "v1", auth: await getOAuthClient() });
}
export async function getGmailApi() {
  return google.gmail({ version: "v1", auth: await getOAuthClient() });
}
export async function getSheetsApi() {
  return google.sheets({ version: "v4", auth: await getOAuthClient() });
}

/**
 * Retry a Google API call on transient failures (rate limiting, brief 5xx
 * blips) with short backoff. Non-transient errors (4xx other than 429, or
 * anything without a recognizable status) fail immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
      const transient = status === 429 || (typeof status === "number" && status >= 500);
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * True when a Google API error is about authorization rather than the request
 * itself — a stored refresh token that predates a newly-added scope (e.g.
 * gmail.send), or one that's been revoked/expired. The fix is always the same:
 * reconnect Google (re-consent) from Settings.
 */
export function isGoogleAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /insufficient (authentication scopes|permission)|invalid_grant|invalid credentials|unauthorized_client|access.*denied/.test(
    msg,
  );
}

/** Resolve a logical calendar to its Google Calendar id from settings. */
export async function calendarId(key: CalendarKey): Promise<string> {
  const s = await getSettings();
  if (key === "personal") return s.personalCalendarId || "primary";
  if (key === "room") {
    if (!s.roomCalendarId) throw new Error("The R5 room calendar isn't set yet — add it in Settings.");
    return s.roomCalendarId;
  }
  if (!s.chalkFarmCalendarId) throw new Error("The Chalk Farm calendar isn't set yet — add it in Settings.");
  return s.chalkFarmCalendarId;
}
