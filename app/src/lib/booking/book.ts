import { prisma, getSettings } from "@/lib/db";
import { createClientWithDrive } from "@/lib/clients";
import {
  cancelBookingEvents,
  createBookingEvents,
  deleteBookingGoogleEvents,
} from "@/lib/google/calendar";
import { syncChalkFarmDayBlock } from "@/lib/google/chalkFarm";
import { sendEmail } from "@/lib/google/gmail";
import { fmtDayLong, fmtTime, londonDateKey } from "@/lib/time";
import { composeBookingEmail } from "./email";
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
  /** set when this booking closes out a Gmail-add-on enquiry — the reply lands in that thread */
  gmailThreadId?: string;
  gmailMessageId?: string;
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
  /** the client's personal intake-form link — already emailed, but also offered as a direct button */
  intakeUrl: string;
  /** false if the confirmation email couldn't be sent (booking still stands) */
  emailSent: boolean;
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

  // The intake link is still returned (offered as its own button / follow-up),
  // but it is no longer stitched into the welcome email — see composeBookingEmail.
  const intakeLink = intakeUrl(settings, await getOrCreateIntakeToken(clientId));
  const email = composeBookingEmail(client, req.clinic, whenLabel, req.sendPayment, settings);
  const body = req.emailBody?.trim() || email.body;
  // Whether this is the client's very first welcome message — captured before we
  // flip welcomeSent, so the confirmation copy and the flip agree.
  const wasFirstEmail = !client.welcomeSent;
  let emailTextForClipboard: string | undefined;
  let emailSent = false;
  // Did the welcome message actually reach the client (emailed by us, or handed
  // to Phoenix on the clipboard to send herself)? A failed send doesn't count.
  let firstContactMade = false;
  if (req.sendEmail && client.email) {
    // The session is already booked (calendar event exists) by this point — a
    // hiccup sending the confirmation shouldn't fail the whole booking and
    // scare the client into thinking they don't have a slot. Fall back to the
    // clipboard text so it's not lost, and let Phoenix know to follow up.
    try {
      await sendEmail(
        client.email,
        email.subject,
        body,
        req.gmailThreadId ? { threadId: req.gmailThreadId, inReplyTo: req.gmailMessageId } : undefined,
      );
      emailSent = true;
      firstContactMade = true;
      await prisma.booking.update({ where: { id: booking.id }, data: { emailSent: true } });
      items.push(
        wasFirstEmail
          ? "Welcome email sent — invite, access note" + (req.sendPayment ? ", payment details" : "")
          : "Email sent — calendar invite",
      );
    } catch (err) {
      console.error("Booking confirmed but the confirmation email failed to send", err);
      emailTextForClipboard = body;
      items.push("Booked, but the confirmation email couldn't be sent — please follow up with them directly");
    }
  } else if (req.sendEmail && !client.email) {
    emailTextForClipboard = body;
    firstContactMade = true;
    items.push("No email address on record yet — email text copied to your clipboard instead");
  } else {
    emailTextForClipboard = body;
    firstContactMade = true;
    items.push("Email text copied to your clipboard — no email was sent");
  }

  // Mark them welcomed once their first welcome message has genuinely gone out —
  // whether we emailed it or Phoenix copied it to send. Without this, a client
  // booked by hand (always sendEmail:false in the enquiry flow) would stay "new"
  // forever and keep being handed the first-timer welcome on every future booking.
  if (wasFirstEmail && firstContactMade) {
    await prisma.client.update({ where: { id: clientId }, data: { welcomeSent: true } });
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
    intakeUrl: intakeLink,
    emailSent,
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
  const oldDateKey = londonDateKey(booking.startsAt);

  await deleteBookingGoogleEvents(booking);
  await prisma.booking.update({
    where: { id: bookingId },
    data: { startsAt: start, personalEventId: "", secondaryEventId: "" },
  });
  await createBookingEvents(bookingId); // re-syncs the new day's Chalk Farm block (Bethnal)

  // Moved to a different day — the old day's shared block needs recomputing
  // too, now this session's no longer part of it.
  const newDateKey = londonDateKey(start);
  if (booking.clinic === "bethnal" && newDateKey !== oldDateKey) {
    await syncChalkFarmDayBlock(oldDateKey);
  }

  return {
    whenLabel: `${fmtDayLong(start)} · ${fmtTime(start)} · ${CLINIC_LABEL[booking.clinic as Clinic]}`,
    clientName: booking.client.name,
  };
}
