import { prisma, getSettings, getSpaces } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { resolveClientCopy, applyCopy, type ClientCopy } from "@/lib/clientCopy";
import { practitionerIdentity } from "@/lib/practitioner";
import { firstUrl, resolveSignOff } from "@/lib/booking/email";
import { spaceById, type Space } from "@/lib/spaces";
import { sessionLocation } from "@/lib/calendarLinks";
import { getOrCreatePortalToken, portalUrl } from "@/lib/portal";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";
import { fmtDayLong, fmtTime, londonAddDays, londonDateKey } from "@/lib/time";

/**
 * The "looking forward to meeting you" email before a new client's FIRST session.
 *
 * Online bookings bring impulse bookings, and impulse bookings bring no-shows.
 * The confirmation email lands the moment someone books — sometimes days before
 * the session, sometimes in a hurry — so this one arrives close to the day, from
 * the practitioner, and asks for the one thing that's still outstanding: the
 * intake form, if it isn't done (with the reassurance that it can be done in the
 * session instead).
 *
 * Sent automatically to every new client, whether or not they ever switched
 * reminders on — that opt-in sits on a page a first-timer has usually never
 * opened. Sent once per client: only their first session qualifies, and the
 * booking is stamped (Booking.firstSessionEmailSentAt) the moment it goes.
 */

export interface FirstSessionEmailInput {
  clientFirstName: string;
  whenLabel: string;
  space: Pick<Space, "name" | "address" | "mapUrl" | "findIt">;
  intakeDone: boolean;
  intakeLink: string;
  portalLink: string;
  /** offer reminders — set when the client hasn't switched any on */
  offerReminders: boolean;
}

/** The email, as text. Pure — the wording is the practitioner's; the facts are placed after it. */
export function composeFirstSessionEmail(
  input: FirstSessionEmailInput,
  copy: ClientCopy,
  signOff: string,
): { subject: string; body: string } {
  const vars = {
    name: input.clientFirstName,
    when: input.whenLabel,
    clinic: input.space.name,
    intakeLink: input.intakeLink,
  };
  const subject = applyCopy(copy.firstSessionSubject, vars);
  const letter = input.intakeDone ? copy.firstSessionBodyIntakeDone : copy.firstSessionBodyIntakeMissing;
  const sections: string[] = [applyCopy(letter, vars)];

  // Where, and how to find the door — the two things a first-timer gets lost on.
  const where = [sessionLocation(input.space), firstUrl(input.space.mapUrl), input.space.findIt.trim()]
    .filter(Boolean)
    .join("\n");
  if (where) sections.push(where);
  sections.push(`Need to move or cancel it? You can do that any time on your own page:\n${input.portalLink}`);
  if (input.offerReminders) sections.push(applyCopy(copy.remindersOfferLine, { link: input.portalLink }));
  sections.push(signOff);
  return { subject, body: sections.filter(Boolean).join("\n\n") };
}

/**
 * Is this session's first-session email due right now? Pure, for testing.
 *
 * Due on the London day before the session. A booking made too late for that
 * (after the morning run the day before, or for later today) gets it on the
 * morning of the session instead — but never one booked the same day, which
 * already has its confirmation from minutes or hours ago.
 */
export function firstSessionEmailDue(
  booking: { startsAt: Date; createdAt: Date; firstSessionEmailSentAt: Date | null },
  asOf: Date,
): boolean {
  if (booking.firstSessionEmailSentAt) return false;
  if (booking.startsAt.getTime() <= asOf.getTime()) return false;
  const today = londonDateKey(asOf);
  const sessionDay = londonDateKey(booking.startsAt);
  if (sessionDay === londonDateKey(londonAddDays(asOf, 1))) return true;
  return sessionDay === today && londonDateKey(booking.createdAt) !== today;
}

export interface FirstSessionSweepResult {
  due: Array<{ bookingId: string; clientName: string; whenLabel: string; intakeDone: boolean }>;
  sent: number;
}

/**
 * Email every new client whose first session is tomorrow (or later today, if
 * they booked too late for yesterday's run). Never throws per booking.
 *
 * When it sends, it also marks the day-before reminder (lead 1) as sent for that
 * session, so a client who did switch reminders on doesn't get two emails about
 * the same session on the same morning. Run it BEFORE sweepSessionReminders.
 */
export async function sweepFirstSessionEmails({
  asOf = new Date(),
  dryRun = false,
}: { asOf?: Date; dryRun?: boolean } = {}): Promise<FirstSessionSweepResult> {
  const settings = await getSettings();
  const spaces = await getSpaces();
  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
  const signOff = resolveSignOff(settings);

  const candidates = await prisma.booking.findMany({
    where: {
      status: "confirmed",
      firstSessionEmailSentAt: null,
      startsAt: { gt: asOf, lt: londonAddDays(asOf, 2) },
      client: { email: { not: "" } },
    },
    include: { client: true },
  });

  const due: FirstSessionSweepResult["due"] = [];
  let sent = 0;
  for (const b of candidates) {
    if (!firstSessionEmailDue(b, asOf)) continue;
    // Only a client's first session: anything earlier that wasn't cancelled
    // means they've been before (or have one booked sooner, which gets this).
    const earlier = await prisma.booking.count({
      where: { clientId: b.clientId, status: { not: "cancelled" }, startsAt: { lt: b.startsAt } },
    });
    if (earlier > 0) continue;

    const whenLabel = `${fmtDayLong(b.startsAt)} · ${fmtTime(b.startsAt)}`;
    due.push({ bookingId: b.id, clientName: b.client.name, whenLabel, intakeDone: b.client.intakeDone });
    if (dryRun) continue;

    try {
      const portalLink = portalUrl(settings, await getOrCreatePortalToken(b.clientId));
      const { subject, body } = composeFirstSessionEmail(
        {
          clientFirstName: b.client.name.split(" ")[0] || "there",
          whenLabel,
          space: spaceById(spaces, b.clinic),
          intakeDone: b.client.intakeDone,
          intakeLink: intakeUrl(settings, await getOrCreateIntakeToken(b.clientId)),
          portalLink,
          offerReminders: !b.client.reminderLeadDays.length,
        },
        copy,
        signOff,
      );
      await sendEmail(b.client.email, subject, body, undefined, undefined, {
        links: [{ url: portalLink, label: "Click here for your booking page" }],
      });
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          firstSessionEmailSentAt: new Date(),
          ...(b.remindersSentLead.includes(1) ? {} : { remindersSentLead: { push: 1 } }),
        },
      });
      sent++;
    } catch (err) {
      // Not stamped, so the next run tries again while it's still due.
      console.error("First-session email failed for booking", b.id, err);
    }
  }
  return { due, sent };
}
