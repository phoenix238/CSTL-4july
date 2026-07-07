import { prisma, getSettings } from "@/lib/db";
import { createClientWithDrive } from "@/lib/clients";
import {
  cancelBookingEvents,
  createBookingEvents,
  deleteBookingGoogleEvents,
} from "@/lib/google/calendar";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { composeBookingEmail, INTAKE_SENTINEL } from "./email";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";
import { CLINIC_LABEL, planBookingEvents, type Clinic } from "./rules";

export interface BookingRequest {
  /** existing client id — or absent with newClient set */
  clientId?: string;
  newClient?: { name: string; email?: string; phone?: string };
  clinic: Clinic;
  startISO: string;
  sendEmail: boolean;
  sendPayment: boolean;
  /** the (possibly hand-edited) email body from the preview box */
  emailBody?: string;
}

export interface BookingResult {
  bookingId: string;
  clientId: string;
  clientName: string;
  whenLabel: string;
  /** ✓-items for the confirmation screen */
  items: string[];
  /** set when no email was sent — the UI copies this to the clipboard */
  emailTextForClipboard?: string;
}

/**
 * The whole booking in one place: (create client) → cancel old slot if any →
 * create calendar events → send/skip email → record it. Mirrors exactly what
 * the design's confirmation screen promises.
 */
export async function bookSession(req: BookingRequest): Promise<BookingResult> {
  const settings = await getSettings();
  const start = new Date(req.startISO);
  const whenLabel = `${fmtDayLong(start)} · ${fmtTime(start)}`;
  const items: string[] = [];

  let clientId = req.clientId ?? "";
  let isNew = false;
  if (!clientId) {
    if (!req.newClient?.name?.trim()) throw new Error("A client name is needed to book.");
    const created = await createClientWithDrive({ ...req.newClient, clinic: req.clinic });
    clientId = created.id;
    isNew = true;
  }
  let client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  // Remember the location they actually booked, so it's the default next time.
  if (!isNew && client.clinic !== req.clinic) {
    client = await prisma.client.update({ where: { id: clientId }, data: { clinic: req.clinic } });
  }

  // Reschedule rule: an existing client's upcoming booking is replaced —
  // the old events are deleted so the old slot is genuinely free again.
  const upcoming = await prisma.booking.findFirst({
    where: { clientId, status: "confirmed", startsAt: { gte: new Date() } },
  });
  let replacedLabel: string | null = null;
  if (upcoming) {
    await cancelBookingEvents(upcoming.id);
    replacedLabel = `${fmtDayLong(upcoming.startsAt)} · ${fmtTime(upcoming.startsAt)}`;
  }

  const booking = await prisma.booking.create({
    data: { clientId, clinic: req.clinic, startsAt: start },
  });
  await createBookingEvents(booking.id);

  const address = req.clinic === "waterloo" ? settings.waterlooAddress : settings.bethnalAddress;
  const plan = planBookingEvents(req.clinic, client.name, start, address);
  for (const ev of plan) {
    const calName =
      ev.calendar === "personal" ? "Personal calendar" : ev.calendar === "room" ? "Room calendar" : "Chalk Farm calendar";
    items.push(
      `"${ev.summary}" created (${calName}, ${fmtTime(ev.start)}–${fmtTime(ev.end)}, reminders on)`,
    );
  }

  const intakeLink = intakeUrl(settings, await getOrCreateIntakeToken(clientId));
  const email = composeBookingEmail(client, req.clinic, whenLabel, req.sendPayment, settings, intakeLink);
  // Use her edited text if any, but always resolve the sentinel to the real link.
  const body = (req.emailBody?.trim() || email.body).split(INTAKE_SENTINEL).join(intakeLink);
  let emailTextForClipboard: string | undefined;
  if (req.sendEmail && client.email) {
    await sendEmail(client.email, email.subject, body);
    await prisma.booking.update({ where: { id: booking.id }, data: { emailSent: true } });
    if (!client.welcomeSent) {
      await prisma.client.update({ where: { id: clientId }, data: { welcomeSent: true } });
    }
    items.push(
      client.welcomeSent && !isNew
        ? "Email sent — calendar invite"
        : "Email sent — invite, intake form link, access note" + (req.sendPayment ? ", payment details" : ""),
    );
  } else if (req.sendEmail && !client.email) {
    emailTextForClipboard = body;
    items.push("No email address on record yet — email text copied to your clipboard instead");
  } else {
    emailTextForClipboard = body;
    items.push("Email text copied to your clipboard — no email was sent");
  }

  items.push(
    isNew
      ? "Client record created · Drive folder + Doc ready — add their details from the profile when you have them"
      : `Added to ${client.name}'s existing record — one record kept`,
  );
  if (replacedLabel) items.push(`Old slot removed — ${replacedLabel} is free again`);

  return {
    bookingId: booking.id,
    clientId,
    clientName: client.name,
    whenLabel: `${whenLabel} · ${CLINIC_LABEL[req.clinic]}`,
    items,
    emailTextForClipboard,
  };
}

/**
 * Move a booking to a new slot: delete the old Google events, update the row,
 * recreate the events (Google re-sends the invite to the client).
 */
export async function rescheduleBooking(bookingId: string, newStartISO: string) {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { client: true },
  });
  if (booking.status !== "confirmed") throw new Error("Only confirmed bookings can be rescheduled.");
  const start = new Date(newStartISO);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid new start time.");

  await deleteBookingGoogleEvents(booking);
  await prisma.booking.update({
    where: { id: bookingId },
    data: { startsAt: start, personalEventId: "", secondaryEventId: "" },
  });
  await createBookingEvents(bookingId);

  return {
    whenLabel: `${fmtDayLong(start)} · ${fmtTime(start)} · ${CLINIC_LABEL[booking.clinic as Clinic]}`,
    clientName: booking.client.name,
  };
}
