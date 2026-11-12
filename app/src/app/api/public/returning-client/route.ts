import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma, getSettings } from "@/lib/db";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/google/gmail";
import { CLINIC_LABEL } from "@/lib/booking/rules";
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
  clinic: z.literal("bethnal"),
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
    const match = matches.length === 1 ? matches[0] : undefined;
    const settings = await getSettings();
    await assertSlotAvailable({ clinic, start });
    const result = await bookSession({
      clientId: match?.id,
      newClient: match ? undefined : { name, email, phone },
      clinic, startISO, bookedVia: "online",
      sendEmail: false, sendPayment: false,
    });

    const details = [
      `From: ${name} <${email}>`,
      `Phone used last time: ${phone}`,
      `Appointment booked: ${result.whenLabel} · ${CLINIC_LABEL[clinic]}`,
      "",
      match
        ? "Returning client — verify and update the email on the linked client record."
        : "Returning client — no unique name and phone match. The appointment is booked under a separate client record. Review it before linking it to any existing record.",
    ].join("\n");
    try {
      const enquiry = await prisma.enquiry.create({
        data: { via: "WEB", name, clinic, text: details, clientId: result.clientId },
      });
      revalidateTag("shell");
      if (process.env.ALLOWED_EMAIL) {
        try {
          await sendEmail(
            process.env.ALLOWED_EMAIL,
            "Returning client booked — email needs review",
            `${details}\n\nReview in Enquiries: ${appBaseUrl(settings)}/enquiries?open=${enquiry.id}`,
            undefined, undefined, { replyTo: email },
          );
        } catch {
          await prisma.enquiry.update({
            where: { id: enquiry.id },
            data: { text: `${details}\n\nNotification email failed to send.` },
          });
        }
      }
    } catch {
      console.error("Could not record a returning-client email review", result.bookingId);
    }
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
