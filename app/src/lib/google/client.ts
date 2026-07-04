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
