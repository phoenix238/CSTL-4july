// Add-to-calendar links for a booked session, so a client can get it onto their
// own calendar however they keep one — a one-tap Google link, or a .ics file
// that Apple Calendar, Outlook and everything else understands.
//
// This is the piece that stops a client turning up on the wrong day: the Google
// Calendar invite already goes to them as an attendee, but that only helps if
// they use Google Calendar and know to accept it. The .ics reaches everyone
// else, and the links are shown plainly on the portal and in the emails rather
// than left implicit in an invite attachment.
//
// Pure and free of Google/Prisma — it just builds strings — so the ICS shape is
// unit-testable.

import { SESSION_EVENT_TITLE, SESSION_MINUTES, CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/** Compact UTC stamp for calendar formats: 2026-09-02T14:00:00Z → "20260902T140000Z". */
export function toCalendarUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape a value for an ICS TEXT field (RFC 5545): backslash, comma, semicolon, newline. */
function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export interface SessionEventDetails {
  /** stable per booking, so re-importing updates the same event rather than duplicating it */
  uid: string;
  start: Date;
  /** defaults to start + one session */
  end?: Date;
  title?: string;
  location?: string;
  description?: string;
  /** lead times (days before) to add as calendar alarms; 0 = the morning of */
  reminderLeadDays?: number[];
}

function endOf(d: SessionEventDetails): Date {
  return d.end ?? new Date(d.start.getTime() + SESSION_MINUTES * 60_000);
}

/**
 * One VALARM per chosen lead time, so a client who imports the .ics gets alerts
 * in their own calendar matching the reminders they asked for. Days map to a
 * whole-day trigger; "the morning of" (0) has no whole-day equivalent, so it
 * becomes an hour-before alarm instead — this fires locally on the client's own
 * phone/calendar app, so it isn't bound by the app's once-a-day email cron the
 * way the "on the morning" email itself is.
 */
function alarms(leadDays: number[] | undefined): string[] {
  const lines: string[] = [];
  for (const days of leadDays ?? []) {
    const trigger = days > 0 ? `-P${days}D` : "-PT1H";
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Reminder",
      `TRIGGER:${trigger}`,
      "END:VALARM",
    );
  }
  return lines;
}

/**
 * A complete VCALENDAR for one session — what the .ics endpoint returns and what
 * an email can link to. CRLF line endings, as the spec requires (some importers,
 * Outlook among them, reject bare LF).
 */
export function buildSessionIcs(d: SessionEventDetails, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CSTL Control Tower//Session//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${d.uid}`,
    `DTSTAMP:${toCalendarUTC(now)}`,
    `DTSTART:${toCalendarUTC(d.start)}`,
    `DTEND:${toCalendarUTC(endOf(d))}`,
    `SUMMARY:${icsEscape(d.title ?? SESSION_EVENT_TITLE)}`,
    ...(d.location ? [`LOCATION:${icsEscape(d.location)}`] : []),
    ...(d.description ? [`DESCRIPTION:${icsEscape(d.description)}`] : []),
    ...alarms(d.reminderLeadDays),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

// No "add to Google Calendar" link is generated: a client on a Google account
// already gets the session on their calendar automatically, as an invited
// attendee. The .ics above covers everyone who keeps their calendar elsewhere.

/** The clinic address to show as an event location, falling back to the clinic name. */
export function sessionLocation(clinic: Clinic, address: string | undefined | null): string {
  return address?.trim() || CLINIC_LABEL[clinic];
}
