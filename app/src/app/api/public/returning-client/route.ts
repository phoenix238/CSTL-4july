import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { fmtDayLong, fmtTime } from "@/lib/time";

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
  try {
    await assertBookingAllowed(req, email);
    await prisma.enquiry.create({
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
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return NextResponse.json({ error: "Too many requests. Please contact Phoenix directly." }, { status: 429 });
    }
    console.error("Returning client request failed", error);
    return NextResponse.json({ error: "Couldn’t send your request. Please try again." }, { status: 500 });
  }
}
