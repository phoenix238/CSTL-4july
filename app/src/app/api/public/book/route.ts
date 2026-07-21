import { NextResponse } from "next/server";
import { prisma, getSettings } from "@/lib/db";
import { getBusySpans } from "@/lib/google/calendar";
import { londonDayStart, londonDateKey } from "@/lib/time";
import { computeAvailableSlots, resolveWeeklyHours } from "@/lib/booking/availability";
import type { Clinic } from "@/lib/booking/rules";
import { findExistingClient } from "@/lib/clients";
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
    const windowStart = londonDayStart(-1, start);
    const windowEnd = londonDayStart(2, start);
    const [overrides, busy] = await Promise.all([
      prisma.availabilityOverride.findMany({
        where: { clinic, date: { gte: londonDateKey(windowStart), lt: londonDateKey(windowEnd) } },
      }),
      getBusySpans(windowStart, windowEnd),
    ]);
    const slots = computeAvailableSlots({
      clinic: clinic as Clinic,
      windowStart,
      windowEnd,
      weeklyHours: resolveWeeklyHours(settings.weeklyHours)[clinic as Clinic],
      overrides: overrides.map((o) => ({ date: o.date, kind: o.kind as "open" | "block", startMin: o.startMin, endMin: o.endMin })),
      // Exclude the shared Chalk Farm day block — only real sessions block time.
      // A studio-mate's real booking on that same calendar gets its own bigger
      // safety gap (see slots/route.ts).
      busy: busy
        .filter((b) => !b.roomBlock)
        .map((b) => ({ ...b, bufferMinutes: b.source === "chalkFarm" ? settings.chalkFarmBufferMinutes : undefined })),
      slotMinutes: settings.bookingSlotMinutes,
      bufferMinutes: settings.bookingBufferMinutes,
      minNoticeMinutes: settings.bookingMinNoticeMins,
    });
    const isReallyAvailable = slots.some((s) => s.getTime() === start.getTime());
    if (!isReallyAvailable) {
      return NextResponse.json({ error: "That time isn't available anymore — please pick another." }, { status: 409 });
    }

    const existing = await findExistingClient(cleanName, cleanEmail, cleanPhone);
    const result = await bookSession({
      clientId: existing?.id,
      newClient: existing ? undefined : { name: cleanName, email: cleanEmail, phone: cleanPhone },
      clinic: clinic as Clinic,
      startISO: start.toISOString(),
      sendEmail: true,
      sendPayment: true,
    });

    // Let Phoenix know a booking came in — non-fatal: the booking itself has
    // already succeeded, so a notification hiccup shouldn't fail the visitor's
    // confirmation. Email lands in Gmail, which already pushes to her phone.
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

    return NextResponse.json({
      whenLabel: result.whenLabel,
      clientName: result.clientName,
      emailSent: result.emailSent,
      intakeUrl: result.intakeUrl,
    });
  } catch (err) {
    // Never surface raw internal/Google API error text to a public visitor.
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again, or get in touch with Phoenix directly." },
      { status: 500 },
    );
  }
}
