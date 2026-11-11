import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma, getSettings } from "@/lib/db";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { fmtDayLong, fmtTime } from "@/lib/time";

import { bookSession } from "@/lib/booking/book";
import { assertSlotAvailable, SlotTakenError } from "@/lib/booking/slots";

function phoneKey(value: string) {
  return value.replace(/\D/g, "").replace(/^(?:0044|44)(?=\d{10}$)/, "0");
}

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

const request = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).regex(/^\+?[\d\s().-]+$/).refine((value) => value.replace(/\D/g, "").length >= 7),
  clinic: z.enum(["waterloo", "bethnal"]),
  startISO: z.string().datetime(),
  company: z.string().trim().max(0).optional(),
});

export async function POST(req: Request) {
  const input = request.safeParse(await req.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "Check your name, email and previous phone number." }, { status: 400 });
  }
  const { name, email, phone, clinic, startISO } = input.data;
  const start = new Date(startISO);
  if (start <= new Date()) return NextResponse.json({ error: "Choose a future appointment." }, { status: 400 });
  try {
    await assertBookingAllowed(req, email);
    const candidates = await prisma.client.findMany({
      where: { phone: { not: "" }, bookings: { some: { status: { not: "cancelled" } } } },
      select: { id: true, phone: true, name: true },
    });
    const phoneNumber = phoneKey(phone);
    const matches = phoneNumber.length >= 10 ? candidates.filter((client) =>
      phoneKey(client.phone) === phoneNumber && nameKey(client.name) === nameKey(name),
    ) : [];
    const enquiry = await prisma.enquiry.create({
      data: {
        via: "WEB",
        name,
        clinic,
        text: [
          `From: ${name} <${email}>`,
          `Phone: ${phone}`,
          "",
          "Returning client — please verify the existing record before adding this email.",
          `Requested appointment: ${fmtDayLong(start)} at ${fmtTime(start)} (not booked).`,
        ].join("\n"),
      },
    });
    revalidateTag("shell");
    if (matches.length !== 1) return NextResponse.json({ booked: false }, { status: 201 });

    const settings = await getSettings();
    await assertSlotAvailable({ clinic, start });
    const result = await bookSession({
      clientId: matches[0].id, clinic, startISO, bookedVia: "online",
      sendEmail: true, sendPayment: true, notifyOwner: settings.bookingNotifyEmail,
    });
    await prisma.enquiry.update({
      where: { id: enquiry.id },
      data: {
        clientId: result.clientId,
        text: enquiry.text.replace(
          `Requested appointment: ${fmtDayLong(start)} at ${fmtTime(start)} (not booked).`,
          `Appointment booked: ${result.whenLabel}. Verify the new email and resend confirmation after updating it.`,
        ),
      },
    }).catch(() => console.error("Could not annotate returning client enquiry", enquiry.id));
    revalidateTag("shell");
    return NextResponse.json({ booked: true }, { status: 201 });
  } catch (error) {
    if (error instanceof SlotTakenError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ error: "Too many requests. Please contact Phoenix directly." }, { status: 429 });
    }
    console.error("Returning client request failed", error);
    return NextResponse.json({ error: "Couldn’t send your request. Please try again." }, { status: 500 });
  }
}
