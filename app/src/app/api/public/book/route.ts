import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings } from "@/lib/db";
import type { Clinic } from "@/lib/booking/rules";
import { assertSlotAvailable, SlotTakenError } from "@/lib/booking/slots";
import { findClientByEmail } from "@/lib/clients";
import { bookSession } from "@/lib/booking/book";
import { isValidEmail } from "@/lib/validate";
import { sendEmail } from "@/lib/google/gmail";

// NOT guarded — public self-booking. Authorization model: we never trust the
// posted startISO; we independently recompute the currently-available slot
// set server-side and only book if the requested start is genuinely in it.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clinic, startISO, name, email, phone, company } = body as {
      clinic?: string;
      startISO?: string;
      name?: string;
      email?: string;
      phone?: string;
      company?: string; // honeypot
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

    // Re-verify: recompute today's real availability and only proceed if the
    // requested slot is genuinely in it — never trust the client's startISO.
    const settings = await getSettings();
    await assertSlotAvailable({ clinic: clinic as Clinic, start });

    // Email only — never the fuzzy name/phone match. See findClientByEmail.
    const existing = await findClientByEmail(cleanEmail);
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
    });

    // Let Phoenix know a booking came in — non-fatal: the booking itself has
    // already succeeded, so a notification hiccup shouldn't fail the visitor's
    // confirmation. Email lands in Gmail, which already pushes to his phone.
    if (settings.bookingNotifyEmail && process.env.ALLOWED_EMAIL) {
      try {
        await sendEmail(
          process.env.ALLOWED_EMAIL,
          `New booking — ${result.clientName}`,
          `${result.clientName} just booked online.\n\n${result.whenLabel}\nContact: ${cleanEmail}${cleanPhone ? ` · ${cleanPhone}` : ""}\n\nBooked via your public booking page.`,
        );
      } catch (err) {
        console.error("Couldn't send booking notification email", err);
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
          text: `Booked online — ${result.whenLabel}`,
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
    });
  } catch (err) {
    // A slot going while they filled the form is normal, not a fault — tell them
    // plainly so they just pick again.
    if (err instanceof SlotTakenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // Never surface raw internal/Google API error text to a public visitor.
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again, or get in touch with Phoenix directly." },
      { status: 500 },
    );
  }
}
