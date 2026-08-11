import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings } from "@/lib/db";
import type { Clinic } from "@/lib/booking/rules";
import { assertSlotAvailable, SlotTakenError } from "@/lib/booking/slots";
import { describeReturningClient, findClientByEmail } from "@/lib/clients";
import { bookSession } from "@/lib/booking/book";
import { isValidEmail } from "@/lib/validate";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { sendEmail } from "@/lib/google/gmail";

// NOT guarded — public self-booking. Authorization model: we never trust the
// posted startISO; we independently recompute the currently-available slot
// set server-side and only book if the requested start is genuinely in it.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clinic, startISO, name, email, phone, company, confirmReturning } = body as {
      clinic?: string;
      startISO?: string;
      name?: string;
      email?: string;
      phone?: string;
      company?: string; // honeypot
      /** the visitor has answered "yes, that's me" to the returning-client prompt */
      confirmReturning?: boolean;
    };

    if (company?.trim()) {
      // Bot filled the hidden field — reject quietly, no booking attempted.
      return NextResponse.json({ error: "Something went wrong" }, { status: 400 });
    }
    if (clinic !== "waterloo" && clinic !== "bethnal") {
      return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
    }
    const start = startISO ? new Date(startISO) : null;
    if (!start || Number.isNaN(start.getTime()) || start < new Date()) {
      return NextResponse.json({ error: "Invalid time" }, { status: 400 });
    }
    const cleanName = name?.trim() ?? "";
    if (!cleanName || cleanName.length > 200) {
      return NextResponse.json({ error: "Please add your name" }, { status: 400 });
    }
    const cleanEmail = email?.trim() ?? "";
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return NextResponse.json({ error: "Please add a valid email" }, { status: 400 });
    }
    const cleanPhone = phone?.trim() ?? "";

    // Before anything that costs: a Drive folder, a Doc, calendar events and an
    // email all follow from here, so the ceiling is checked first, not after.
    // A confirming second pass is the same booking continuing, so it's checked
    // against the ceiling but doesn't add to it.
    await assertBookingAllowed(req, cleanEmail, { record: !confirmReturning });

    // Re-verify: recompute today's real availability and only proceed if the
    // requested slot is genuinely in it — never trust the client's startISO.
    const settings = await getSettings();
    await assertSlotAvailable({ clinic: clinic as Clinic, start });

    // Email only — never the fuzzy name/phone match. See findClientByEmail.
    const existing = await findClientByEmail(cleanEmail);

    // Recognised, and they haven't said so yet: stop and ask. Booking straight
    // into someone else's record on a shared or mistyped address is worse than
    // one extra tap, and the alternative — creating a second record for the
    // same person — is what scatters one client's history across several.
    if (existing && !confirmReturning) {
      const { knownName, nameMatches } = describeReturningClient(existing.name, cleanName);
      return NextResponse.json({
        needsConfirm: true,
        knownName,
        // Whether they still owe us an intake form decides what the prompt can
        // promise them about the next step.
        intakeDone: existing.intakeDone,
        prompt: nameMatches
          ? `Welcome back${knownName ? `, ${knownName}` : ""} — is this you?`
          : "We already have someone booking with that email address. Is this you?",
      });
    }

    const result = await bookSession({
      clientId: existing?.id,
      newClient: existing ? undefined : { name: cleanName, email: cleanEmail, phone: cleanPhone },
      clinic: clinic as Clinic,
      startISO: start.toISOString(),
      sendEmail: true,
      sendPayment: true,
      bookedVia: "online",
      // A returning client booking here is arranging another session, not moving
      // the one they already have. Moving is what the portal's reschedule is for.
      replaceUpcoming: false,
      // Phoenix is told by being blind-copied on the client's own confirmation
      // below — one email about one booking, not a confirmation plus a summary.
      notifyOwner: settings.bookingNotifyEmail,
    });

    // The Bcc only exists if the client's email actually went out. When it
    // didn't, the booking is real and Phoenix knows nothing about it — so this
    // is the one case that still needs a message of its own, and it's the
    // message that matters most: someone is booked and has nothing in writing.
    if (settings.bookingNotifyEmail && process.env.ALLOWED_EMAIL && !result.emailSent) {
      try {
        await sendEmail(
          process.env.ALLOWED_EMAIL,
          `Booked, but not emailed — ${result.clientName}`,
          [
            `${result.clientName} booked online, and the confirmation email did not go out. They have nothing in writing — please get in touch with them directly.`,
            "",
            result.whenLabel,
            `Contact: ${cleanEmail}${cleanPhone ? ` · ${cleanPhone}` : ""}`,
            "",
            result.emailError ? `Google said: ${result.emailError}` : "",
            "Check Settings › Behind the scenes › Google for the current state of the connection.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (err) {
        console.error("Couldn't send the failed-confirmation alert", err);
      }
    }

    // Surface the booking in the in-app inbox too, so it isn't invisible if the
    // notification email is missed — a light, already-done entry Phoenix can
    // glance at and dismiss. Non-fatal for the same reason as the email above.
    try {
      await prisma.enquiry.create({
        data: {
          via: "ONLINE",
          name: result.clientName,
          text: `Booked online — ${result.whenLabel}${result.emailSent ? "" : " · confirmation email FAILED, please follow up"}`,
          status: "booked_online",
          clientId: result.clientId,
        },
      });
      revalidateTag("shell");
    } catch (err) {
      console.error("Couldn't record the online booking in the inbox", err);
    }

    return NextResponse.json({
      whenLabel: result.whenLabel,
      clientName: result.clientName,
      emailSent: result.emailSent,
      intakeUrl: result.intakeUrl,
      // A returning client who has already filled the form in is not asked for
      // it again — the confirmation screen uses these to decide.
      returning: result.returning,
      intakeDone: result.intakeDone,
    });
  } catch (err) {
    // A slot going while they filled the form is normal, not a fault — tell them
    // plainly so they just pick again.
    if (err instanceof SlotTakenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // Booking too often — a real message they can act on, not a generic 500.
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    // Never surface raw internal/Google API error text to a public visitor.
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again, or get in touch with Phoenix directly." },
      { status: 500 },
    );
  }
}
