import { prisma, getSettings, getSpaces } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { applyCopy, applyCopyOptional, resolveClientCopy, type ClientCopy } from "@/lib/clientCopy";
import { practitionerIdentity } from "@/lib/practitioner";
import { resolveSignOff } from "@/lib/booking/email";
import { formatPence } from "@/lib/account";
export { cancellationPolicyText } from "@/lib/account";
import { spaceName } from "@/lib/spaces";
import { getPortalIdentity, portalUrl } from "@/lib/portal";
import { fmtDayLong, fmtTime } from "@/lib/time";

/**
 * Missed sessions, and the one rule clients are told about them.
 *
 * The rule is the existing short-notice contribution (Settings › Client pages):
 * move or cancel inside the notice window, or miss the session, and the room is
 * already paid for, so a contribution towards it is asked for. One amount for
 * both, stated up front — on the booking page, in the first confirmation and on
 * the client's own page — so the email after a no-show is never a surprise.
 *
 * Like every goodwill ask in this app it's an invitation, never a debt: it's
 * recorded on the booking (goodwillPence, reason "no_show") and shown apart
 * from what's owed.
 */

/** The email after a no-show, as text. Pure. */
export function composeNoShowEmail(
  input: {
    clientFirstName: string;
    whenLabel: string;
    clinicName: string;
    contributionPence: number;
    paymentRef: string;
    portalLink: string;
  },
  copy: ClientCopy,
  signOff: string,
): { subject: string; body: string } {
  const vars = { name: input.clientFirstName, when: input.whenLabel, clinic: input.clinicName };
  const sections = [applyCopyOptional(copy.noShowEmailBody, vars)];
  if (input.contributionPence > 0) {
    sections.push(
      applyCopyOptional(copy.noShowGoodwillText, {
        amount: formatPence(input.contributionPence),
        paymentRef: input.paymentRef,
      }),
    );
  }
  if (input.portalLink) sections.push(applyCopyOptional(copy.cancelRebookLine, { link: input.portalLink }));
  sections.push(signOff);
  return { subject: applyCopy(copy.noShowEmailSubject, vars), body: sections.filter(Boolean).join("\n\n") };
}

/**
 * Mark a session as missed. The session stops counting as one that's owed for,
 * and the short-notice contribution is recorded against it instead. Optionally
 * emails the client. Only for a session whose start time has passed.
 */
export async function markNoShow(
  bookingId: string,
  { email }: { email: boolean },
): Promise<{ emailedTo: string | null; contributionPence: number; emailError?: string }> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { client: true } });
  if (booking.startsAt.getTime() > Date.now()) throw new Error("That session hasn't started yet.");
  if (booking.status === "cancelled" && booking.cancelledBy !== "no_show") {
    throw new Error("That session was cancelled, so it can't also be a no-show.");
  }
  if (booking.paid) throw new Error("That session is marked paid — undo the payment first if they didn't come.");

  const settings = await getSettings();
  const contributionPence = Math.max(0, settings.lateCancelGoodwillPence);
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "cancelled",
      cancelledBy: "no_show",
      cancelledAt: booking.cancelledAt ?? new Date(),
      goodwillPence: contributionPence,
      goodwillReason: contributionPence > 0 ? "no_show" : "",
      goodwillSettled: false,
      goodwillWaived: false,
    },
  });

  if (!email || !booking.client.email) return { emailedTo: null, contributionPence };

  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
  const { token, paymentRef } = await getPortalIdentity(booking.clientId);
  const portalLink = portalUrl(settings, token);
  const { subject, body } = composeNoShowEmail(
    {
      clientFirstName: booking.client.name.split(" ")[0] || "there",
      whenLabel: `${fmtDayLong(booking.startsAt)} · ${fmtTime(booking.startsAt)}`,
      clinicName: spaceName(await getSpaces(), booking.clinic),
      contributionPence,
      paymentRef,
      portalLink,
    },
    copy,
    resolveSignOff(settings),
  );
  try {
    await sendEmail(booking.client.email, subject, body, undefined, undefined, {
      links: portalLink ? [{ url: portalLink, label: "Click here for your booking page" }] : undefined,
    });
  } catch (err) {
    // The session is marked either way — say the email didn't go, don't undo the mark.
    return { emailedTo: null, contributionPence, emailError: err instanceof Error ? err.message : "Email failed" };
  }
  return { emailedTo: booking.client.email, contributionPence };
}

/** Undo a no-show marked by mistake — the session is back to an ordinary past one. */
export async function undoNoShow(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  if (booking.cancelledBy !== "no_show") throw new Error("That session isn't marked as a no-show.");
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "confirmed",
      cancelledBy: "",
      cancelledAt: null,
      goodwillPence: 0,
      goodwillReason: "",
      goodwillSettled: false,
      goodwillWaived: false,
    },
  });
}
