import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { resolveClientCopy, applyCopy, type ClientCopy } from "@/lib/clientCopy";
import { resolveSignOff } from "@/lib/booking/email";
import { CLINIC_LABEL, SESSION_EVENT_TITLE, type Clinic } from "@/lib/booking/rules";
import { buildSessionIcs, googleCalendarUrl, sessionLocation } from "@/lib/calendarLinks";
import { portalUrl } from "@/lib/portal";
import { appBaseUrl } from "@/lib/appUrl";
import { fmtDayLong, fmtTime, londonAddDays, londonDateKey } from "@/lib/time";

/**
 * The app's own session reminders — emails it sends itself, at the lead times a
 * client picked on their portal (Client.reminderLeadDays), independent of
 * whether they use Google Calendar. The Google invite already reaches a client
 * who keeps a Google calendar and accepts it; this is the safety net for
 * everyone else — the client who turned up on the wrong day because the invite
 * never made it into a calendar they actually look at.
 *
 * Runs from the daily cron, so the lead times are day-granular by design.
 */

/** The link to a session's downloadable .ics, served by the portal's own route. */
export function icsUrl(settings: { appUrl?: string | null }, token: string, bookingId: string): string {
  return `${appBaseUrl(settings)}/api/portal/${token}/ics?b=${encodeURIComponent(bookingId)}`;
}

export interface ReminderEmailInput {
  clientName: string;
  whenLabel: string;
  clinic: Clinic;
  location: string;
  googleUrl: string;
  icsUrl: string;
  portalLink: string;
}

/**
 * The reminder email, as text. Pure — the voice comes from the editable copy,
 * the facts (when, where, how to add it to a calendar, where to manage it) are
 * placed around it, so the wording can be changed without losing the links that
 * make the email do its job.
 */
export function composeSessionReminder(
  input: ReminderEmailInput,
  copy: ClientCopy,
  signOff: string,
): { subject: string; body: string } {
  const vars = { name: input.clientName, when: input.whenLabel, clinic: CLINIC_LABEL[input.clinic] };
  const subject = applyCopy(copy.reminderEmailSubject, vars);

  const sections: string[] = [applyCopy(copy.reminderEmailBody, vars)];
  if (input.location) sections.push(`Where: ${input.location}`);
  sections.push(
    [
      "Add it to your own calendar so it's there wherever you look:",
      `• Google Calendar: ${input.googleUrl}`,
      `• Apple Calendar / Outlook / other: ${input.icsUrl}`,
    ].join("\n"),
  );
  sections.push(`Need to move or cancel it? You can do that any time on your own page:\n${input.portalLink}`);
  sections.push(signOff);
  return { subject, body: sections.filter(Boolean).join("\n\n") };
}

/**
 * Which of a client's chosen lead times should fire for this session on the
 * given day, and haven't already been sent. Pure, so the day-matching logic is
 * testable without the DB. A lead of L days fires on the London calendar date L
 * days before the session's own London date; "the morning of" (0) fires on the
 * session's date. A session already in the past is never reminded about.
 */
export function dueLeadDays(
  booking: { startsAt: Date; remindersSentLead: number[] },
  clientLeadDays: number[],
  asOf: Date,
): number[] {
  if (booking.startsAt.getTime() <= asOf.getTime()) return [];
  const todayKey = londonDateKey(asOf);
  const already = new Set(booking.remindersSentLead);
  return clientLeadDays.filter((L) => {
    if (already.has(L)) return false;
    return londonDateKey(londonAddDays(booking.startsAt, -L)) === todayKey;
  });
}

export interface ReminderSweepResult {
  /** bookings that had at least one reminder due */
  due: Array<{ bookingId: string; clientName: string; leadDays: number[]; whenLabel: string }>;
  /** how many emails were actually sent (0 on a dry run) */
  sent: number;
}

/**
 * Find every upcoming session whose client wants a reminder today, email it, and
 * record which lead times have gone out so each fires exactly once. Never throws
 * per booking — one client's send failing must not stop the rest — and never
 * fails the whole cron run.
 *
 * `dryRun` reports what would send without emailing or stamping anything, so the
 * day-matching can be checked against a chosen `asOf` without waiting for a real
 * calendar day to arrive.
 */
export async function sweepSessionReminders({
  asOf = new Date(),
  dryRun = false,
}: { asOf?: Date; dryRun?: boolean } = {}): Promise<ReminderSweepResult> {
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy);
  const signOff = resolveSignOff(settings);

  // Only sessions still ahead of us, whose client has an email and at least one
  // reminder switched on. A window to the furthest lead time keeps the scan small.
  const horizon = londonAddDays(asOf, 8); // largest lead is a week; a day's slack
  const bookings = await prisma.booking.findMany({
    where: {
      status: "confirmed",
      startsAt: { gt: asOf, lt: horizon },
      client: { email: { not: "" }, reminderLeadDays: { isEmpty: false } },
    },
    include: { client: true },
  });

  const due: ReminderSweepResult["due"] = [];
  let sent = 0;

  for (const b of bookings) {
    const leads = dueLeadDays(b, b.client.reminderLeadDays, asOf);
    if (!leads.length) continue;

    const clinic = b.clinic as Clinic;
    const whenLabel = `${fmtDayLong(b.startsAt)} · ${fmtTime(b.startsAt)}`;
    due.push({ bookingId: b.id, clientName: b.client.name, leadDays: leads, whenLabel });
    if (dryRun) continue;

    try {
      const token = b.client.portalToken;
      const address = clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
      const location = sessionLocation(clinic, address);
      const portalLink = token ? portalUrl(settings, token) : "";
      const google = googleCalendarUrl({
        uid: b.id,
        start: b.startsAt,
        title: SESSION_EVENT_TITLE,
        location,
        description: portalLink ? `Manage this session: ${portalLink}` : undefined,
      });
      const ics = token ? icsUrl(settings, token, b.id) : "";
      const { subject, body } = composeSessionReminder(
        { clientName: b.client.name, whenLabel, clinic, location, googleUrl: google, icsUrl: ics, portalLink },
        copy,
        signOff,
      );
      await sendEmail(b.client.email, subject, body);
      await prisma.booking.update({
        where: { id: b.id },
        data: { remindersSentLead: { push: leads } },
      });
      sent++;
    } catch (err) {
      // One client's reminder failing shouldn't stop the others or the cron run.
      // It isn't stamped as sent, so the next daily run tries again while the day
      // still matches.
      console.error("Session reminder failed for booking", b.id, err);
    }
  }

  return { due, sent };
}
