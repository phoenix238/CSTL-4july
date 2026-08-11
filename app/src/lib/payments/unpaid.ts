import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { resolveSignOff } from "@/lib/booking/email";
import { getPortalIdentity, portalUrl } from "@/lib/portal";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/** How long after a session we start treating it as overdue for payment. */
export const UNPAID_AFTER_HOURS = 25;

export interface UnpaidSession {
  bookingId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  whenLabel: string;
  clinic: Clinic;
  paymentReminderSentAt: Date | null;
}

/**
 * Sessions that happened at least UNPAID_AFTER_HOURS ago and still aren't paid.
 * Cancelled sessions and clients without an email are left out — there's nothing
 * to chase. `asOf` is injectable so the boundary is testable without waiting.
 */
export async function findUnpaidSessions(asOf: Date = new Date()): Promise<UnpaidSession[]> {
  const cutoff = new Date(asOf.getTime() - UNPAID_AFTER_HOURS * 3_600_000);
  const bookings = await prisma.booking.findMany({
    where: {
      paid: false,
      status: { not: "cancelled" },
      startsAt: { lte: cutoff },
      client: { email: { not: "" } },
    },
    orderBy: { startsAt: "asc" },
    include: { client: { select: { id: true, name: true, email: true } } },
  });
  return bookings.map((b) => ({
    bookingId: b.id,
    clientId: b.clientId,
    clientName: b.client.name,
    clientEmail: b.client.email,
    whenLabel: `${fmtDayLong(b.startsAt)} · ${fmtTime(b.startsAt)}`,
    clinic: b.clinic as Clinic,
    paymentReminderSentAt: b.paymentReminderSentAt,
  }));
}

/**
 * Flag sessions that are overdue for payment.
 *
 * Per Phoenix's choice this notifies him and leaves the actual chase a one-tap
 * button — it never emails the client. Each session is flagged to him once
 * (unpaidNotifiedAt), so the hourly sweep doesn't repeat itself. In dry-run
 * nothing is written or emailed; it just reports what it would do.
 */
export async function sweepUnpaidSessions({
  asOf = new Date(),
  dryRun = false,
}: { asOf?: Date; dryRun?: boolean } = {}): Promise<{ overdue: UnpaidSession[]; newlyFlagged: UnpaidSession[] }> {
  const cutoff = new Date(asOf.getTime() - UNPAID_AFTER_HOURS * 3_600_000);
  const rows = await prisma.booking.findMany({
    where: {
      paid: false,
      status: { not: "cancelled" },
      startsAt: { lte: cutoff },
      client: { email: { not: "" } },
    },
    orderBy: { startsAt: "asc" },
    include: { client: { select: { id: true, name: true, email: true } } },
  });

  const overdue: UnpaidSession[] = rows.map((b) => ({
    bookingId: b.id,
    clientId: b.clientId,
    clientName: b.client.name,
    clientEmail: b.client.email,
    whenLabel: `${fmtDayLong(b.startsAt)} · ${fmtTime(b.startsAt)}`,
    clinic: b.clinic as Clinic,
    paymentReminderSentAt: b.paymentReminderSentAt,
  }));

  const newlyFlagged = overdue.filter((_, i) => rows[i].unpaidNotifiedAt === null);
  if (dryRun || !newlyFlagged.length) return { overdue, newlyFlagged };

  const to = process.env.ALLOWED_EMAIL;
  if (to) {
    const lines = [
      `${newlyFlagged.length} session${newlyFlagged.length === 1 ? " is" : "s are"} still unpaid a day on:`,
      "",
      ...newlyFlagged.map((s) => `  ${s.clientName} — ${s.whenLabel} · ${CLINIC_LABEL[s.clinic]}`),
      "",
      "Send a reminder to any of them with one tap from Today, or leave it — nothing is chased automatically.",
    ];
    try {
      await sendEmail(
        to,
        `${newlyFlagged.length} unpaid session${newlyFlagged.length === 1 ? "" : "s"}`,
        lines.join("\n"),
      );
    } catch (err) {
      console.error("Couldn't send the unpaid-sessions notification", err);
    }
  }

  await prisma.booking.updateMany({
    where: { id: { in: newlyFlagged.map((s) => s.bookingId) } },
    data: { unpaidNotifiedAt: asOf },
  });

  return { overdue, newlyFlagged };
}

/** Settings fields the reminder email reads — a plain shape so it stays pure. */
export interface ReminderSettings {
  bankAccountName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  emailSignOff?: string;
}

/**
 * The gentle payment-reminder email, as text. Pure, so the same wording is used
 * by the real send and by the "send myself a test" panel.
 */
export function composePaymentReminder(
  settings: ReminderSettings,
  input: { clientName: string; whenLabel: string; clinic: Clinic; paymentRef?: string; portalLink?: string },
): { subject: string; body: string } {
  const first = input.clientName.split(" ")[0] || "there";
  const lines = [
    `Hi ${first},`,
    "",
    `Just a gentle note about your session on ${input.whenLabel} at ${CLINIC_LABEL[input.clinic]} — whenever you're able, here's how to settle it.`,
  ];
  const bank = [
    settings.bankAccountName?.trim() && `  Account name: ${settings.bankAccountName.trim()}`,
    settings.bankSortCode?.trim() && `  Sort code: ${settings.bankSortCode.trim()}`,
    settings.bankAccountNumber?.trim() && `  Account number: ${settings.bankAccountNumber.trim()}`,
    input.paymentRef && `  Reference: ${input.paymentRef}`,
  ].filter(Boolean) as string[];
  if (bank.length) {
    lines.push("", "For a bank transfer:", ...bank);
    if (input.paymentRef) lines.push("Please use that reference — it's how I match your payment to you.");
  }
  if (input.portalLink) lines.push("", "You can also see this any time on your own page:", input.portalLink);
  lines.push(
    "",
    "This is a donation-based practice, so pay what feels right — and if now isn't a good time, that's completely okay.",
    "",
    ...resolveSignOff(settings).split("\n"),
  );
  return { subject: "Your craniosacral session", body: lines.join("\n") };
}

/**
 * Send one gentle payment reminder to a client for a specific session, and stamp
 * it so they're chased at most once. Returns who it went to.
 */
export async function sendPaymentReminder(bookingId: string): Promise<{ sentTo: string }> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { client: { select: { id: true, name: true, email: true } } },
  });
  if (booking.paid) throw new Error("That session is already marked paid.");
  if (!booking.client.email) throw new Error("No email on file for this client.");

  const settings = await getSettings();
  const { token, paymentRef } = await getPortalIdentity(booking.client.id);
  const { subject, body } = composePaymentReminder(settings, {
    clientName: booking.client.name,
    whenLabel: `${fmtDayLong(booking.startsAt)} · ${fmtTime(booking.startsAt)}`,
    clinic: booking.clinic as Clinic,
    paymentRef,
    portalLink: portalUrl(settings, token),
  });

  await sendEmail(booking.client.email, subject, body);
  await prisma.booking.update({ where: { id: bookingId }, data: { paymentReminderSentAt: new Date() } });
  return { sentTo: booking.client.email };
}
