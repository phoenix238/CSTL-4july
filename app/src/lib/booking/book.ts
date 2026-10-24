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
import { composeBookingEmail, fillPreviewLinks, resolveClinicPhoto } from "./email";
import { parseDataUrl } from "@/lib/google/mime";
import { getOrCreateIntakeToken, intakeUrl } from "@/lib/intake";
import { getPortalIdentity, portalUrl } from "@/lib/portal";
import { icsUrl } from "@/lib/reminders/sessionReminders";
import { googleErrorMessage } from "@/lib/google/health";
import { defaultAmountPence } from "@/lib/account";
import { CLINIC_LABEL, SESSION_MINUTES, type Clinic } from "./rules";
import { SlotTakenError } from "./slots";

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
  /** where the booking came from: admin | online | portal | offer */
  bookedVia?: string;
  /**
   * Treat this as a move rather than an addition: cancel the client's existing
   * upcoming session and free its slot.
   *
   * Defaults to false — booking a session *adds* one, on every path (calendar,
   * enquiry panel, offer accept, public page, client portal), so a client can
   * hold several at once. Moving a session is a separate action with its own
   * route (rescheduleBooking), so nothing here needs to replace; this stays only
   * as an explicit opt-in for a future caller that genuinely means "move them".
   */
  replaceUpcoming?: boolean;
  /**
   * Blind-copy Phoenix on the client's own confirmation.
   *
   * Set for the bookings he isn't present for (the public page, the client
   * portal). He gets the exact email the client got — one message about one
   * booking — instead of that email plus a separately-worded "someone booked"
   * summary landing beside it.
   */
  notifyOwner?: boolean;
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
  /** the client's permanent booking page — where they rebook from here on */
  portalUrl: string;
  /** false if the confirmation email couldn't be sent (booking still stands) */
  emailSent: boolean;
  /** true if they'd already filled in their intake form before this booking — skips the "send it" nag */
  intakeDone: boolean;
  /** false when this was the client's very first booking with us */
  returning: boolean;
  /** what Google said when the confirmation email failed — for Phoenix, never the client */
  emailError?: string;
}

/** Retry a Gmail send through the usual transient failures before giving up. */
async function withEmailRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * Create the booking row, refusing to put two sessions on top of each other.
 *
 * Availability has already been checked by this point, but checking and writing
 * were two separate steps with a gap between them — long enough for two people
 * on the public page to both be told a slot was free and both be booked into
 * it. A Postgres advisory lock, held for the length of the transaction and
 * keyed on the London day, serialises everything touching that day: the second
 * request waits, re-reads, sees the first booking and is turned away with the
 * SlotTakenError the routes already render as a friendly "pick another".
 *
 * The overlap check spans both clinics deliberately — whatever the room
 * situation, Phoenix can only be in one session at a time. It's a floor under
 * the real availability rules, not a replacement for them.
 */
async function createBookingRow({
  clientId,
  clinic,
  start,
  bookedVia,
}: {
  clientId: string;
  clinic: Clinic;
  start: Date;
  bookedVia: string;
}) {
  const end = new Date(start.getTime() + SESSION_MINUTES * 60_000);
  return prisma.$transaction(async (tx) => {
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void, which
    // $queryRaw tries to deserialize as a result column and fails on — this is
    // called purely for its side effect (holding the lock for the transaction).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${londonDateKey(start)}`}))`;
    const clash = await tx.booking.findFirst({
      where: {
        status: "confirmed",
        startsAt: { gt: new Date(start.getTime() - SESSION_MINUTES * 60_000), lt: end },
      },
    });
    if (clash) throw new SlotTakenError();
    return tx.booking.create({
      data: {
        clientId,
        clinic,
        startsAt: start,
        bookedVia,
        // Waterloo has a fixed price, so it's known the moment the session is booked.
        // Bethnal Green is a sliding scale the client chooses — left null rather than
        // guessed, and filled in from the profile once the real amount is known.
        amountPence: defaultAmountPence(clinic),
      },
    });
  });
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

  // Only when the caller explicitly asks to move the client (replaceUpcoming:
  // true) is their existing upcoming session cancelled and its slot freed.
  // The default is to add — every booking path leaves prior sessions intact, so
  // "book a session" never silently removes one the client already has.
  let replacedLabel: string | null = null;
  if (req.replaceUpcoming) {
    const upcoming = await prisma.booking.findFirst({
      where: { clientId, status: "confirmed", startsAt: { gte: new Date() } },
    });
    if (upcoming) {
      await cancelBookingEvents(upcoming.id);
      replacedLabel = `${fmtDayLong(upcoming.startsAt)} · ${fmtTime(upcoming.startsAt)}`;
    }
  }

  const booking = await createBookingRow({
    clientId,
    clinic: req.clinic,
    start,
    bookedVia: req.bookedVia ?? "admin",
  });
  // Reuses the exact plan createBookingEvents wrote to Google — recomputing it
  // here would risk disagreeing about which room actually got booked, since
  // that choice depends on live calendar state (see chooseWaterlooRoom).
  const { plan } = await createBookingEvents(booking.id);
  for (const ev of plan) {
    const calName =
      ev.calendar === "personal"
        ? "Personal calendar"
        : ev.calendar === "room"
          ? "Room calendar"
          : ev.calendar === "roomFallback"
            ? "Fallback room calendar"
            : "Chalk Farm calendar";
    items.push(
      `"${ev.summary}" created (${calName}, ${fmtTime(ev.start)}–${fmtTime(ev.end)}, reminders on)`,
    );
  }

  // Everything personal to this client, resolved before the letter is written.
  // The intake link and the booking page are both folded into the first welcome
  // email (see composeBookingEmail) so a new client gets one message rather than
  // three; both are returned too, for the resend buttons on their profile.
  const intakeLink = intakeUrl(settings, await getOrCreateIntakeToken(clientId));
  const { token: portalToken, paymentRef } = await getPortalIdentity(clientId);
  const portalLink = portalUrl(settings, portalToken);
  // Add-to-calendar link for a client who keeps their calendar somewhere other
  // than Google — a Google-account client already has the session automatically,
  // as an invited attendee, so no Google link is offered.
  const calendarIcsUrl = icsUrl(settings, portalToken, booking.id);
  const links = { intakeLink, portalLink, paymentRef, calendarIcsUrl };
  const email = composeBookingEmail(client, req.clinic, whenLabel, req.sendPayment, settings, links);
  // The photo of the entrance, sent inline under the text so the client can see
  // the door they're looking for without following a link.
  const photo = parseDataUrl(resolveClinicPhoto(req.clinic, settings));
  const attachments = photo
    ? [{ filename: `${req.clinic === "waterloo" ? "waterloo" : "bethnal-green"}-entrance.jpg`, ...photo, inline: true }]
    : undefined;
  // A hand-edited body comes from the preview, which was composed before this
  // client had tokens — so its placeholder links are swapped for the real ones
  // rather than sent as written.
  const body = req.emailBody?.trim() ? fillPreviewLinks(req.emailBody.trim(), links) : email.body;
  // Each token-bearing link shown as a friendly hyperlink rather than the raw
  // URL, in any inbox that renders HTML — whichever of these actually made it
  // into `body` (a hand-edited version might have dropped one).
  const emailLinks = [
    { url: portalLink, label: "Click here for your booking page" },
    { url: intakeLink, label: "Click here for your intake form" },
    { url: calendarIcsUrl, label: "Add to calendar" },
  ].filter((l) => l.url);
  // Whether this is the client's very first welcome message — captured before we
  // flip welcomeSent, so the confirmation copy and the flip agree.
  const wasFirstEmail = !client.welcomeSent;
  let emailTextForClipboard: string | undefined;
  let emailSent = false;
  let emailError: string | undefined;
  // Blind copy for the bookings Phoenix isn't in the room for. Only ever his own
  // address from the environment — never anything from the request.
  const bcc = req.notifyOwner ? process.env.ALLOWED_EMAIL || undefined : undefined;
  // Did the welcome message actually reach the client (emailed by us, or handed
  // to Phoenix on the clipboard to send himself)? A failed send doesn't count.
  let firstContactMade = false;
  if (req.sendEmail && client.email) {
    // The session is already booked (calendar event exists) by this point — a
    // hiccup sending the confirmation shouldn't fail the whole booking and
    // scare the client into thinking they don't have a slot. Fall back to the
    // clipboard text so it's not lost, and let Phoenix know to follow up.
    try {
      // Retried, because this is the client's only written record that their
      // session exists — the confirmation screen is gone the moment they close
      // the tab. A transient Gmail hiccup shouldn't cost them that.
      await withEmailRetry(() =>
        sendEmail(
          client.email,
          email.subject,
          body,
          req.gmailThreadId ? { threadId: req.gmailThreadId, inReplyTo: req.gmailMessageId } : undefined,
          attachments,
          { bcc, links: emailLinks },
        ),
      );
      emailSent = true;
      firstContactMade = true;
      await prisma.booking.update({ where: { id: booking.id }, data: { emailSent: true } });
      items.push(
        wasFirstEmail
          ? "Welcome email sent — invite, access note, booking page" + (req.sendPayment ? ", payment details" : "")
          : "Email sent — calendar invite",
      );
      if (bcc) items.push("Copied to you — the same email the client got");
    } catch (err) {
      console.error("Booking confirmed but the confirmation email failed to send", err);
      // Kept so the caller can tell Phoenix what Google actually objected to,
      // rather than leaving him with a booking that "just didn't email".
      emailError = googleErrorMessage(err);
      emailTextForClipboard = body;
      // The booking stands and the client has nothing in writing. Record that
      // plainly on the row so it can be found and resent, rather than living
      // only in a server log nobody reads.
      await prisma.booking.update({
        where: { id: booking.id },
        data: { confirmationFailedAt: new Date() },
      });
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
    portalUrl: portalLink,
    emailSent,
    intakeDone: client.intakeDone,
    returning: !isNew,
    emailError,
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
    // The booking row survives the move, so its payment state travels with it —
    // a client who has already paid and then reshuffles the time doesn't get
    // silently marked unpaid.
    data: {
      startsAt: start,
      personalEventId: "",
      secondaryEventId: "",
      rescheduleCount: { increment: 1 },
      // A moved session earns its reminders afresh against the new date — clear
      // what was already sent so the day-before / morning-of nudge fires again.
      remindersSentLead: [],
    },
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
    previousWhenLabel: `${fmtDayLong(booking.startsAt)} · ${fmtTime(booking.startsAt)}`,
    clientId: booking.clientId,
    clinic: booking.clinic as Clinic,
  };
}
