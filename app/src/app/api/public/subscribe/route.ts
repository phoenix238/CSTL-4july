import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidEmail } from "@/lib/validate";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { upsertMarketingRow } from "@/lib/google/sheets";

/**
 * Cross-origin by design — called from craniosacraltherapylondon.com's footer
 * "seasonal newsletter" form (assets/track.js), the same trust model and origin
 * allow-list as /api/public/enquiry. A website visitor who isn't a client yet
 * opts into the newsletter: they're added to the marketing sheet (Phoenix's
 * mail-merge list) WITHOUT creating a clinical Client record — that model
 * carries intake/portal/payment fields a newsletter signup has no business
 * creating. If the email already belongs to a client, their marketing flag is
 * flipped on instead, so the database and the sheet agree.
 */
const ALLOWED_ORIGINS = [
  "https://craniosacraltherapylondon.com",
  "https://phoenix238.github.io",
  "http://localhost:8090",
];

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

// Public — the site's newsletter form. Same defences as /api/public/enquiry:
// honeypot + the shared rate limiter (keyed on email/IP).
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));

  try {
    const body = await req.json();
    const { email, website } = body as {
      email?: string;
      website?: string; // honeypot — real visitors never see or fill it
      page?: string;
    };

    if (website?.trim()) {
      // Bot filled the hidden field — reject quietly, nothing recorded.
      return NextResponse.json({ error: "Something went wrong" }, { status: 400, headers });
    }

    const cleanEmail = email?.trim() ?? "";
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return NextResponse.json({ error: "Please add a valid email" }, { status: 400, headers });
    }

    try {
      await assertBookingAllowed(req, cleanEmail);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        return NextResponse.json(
          { error: "That's a few attempts in a short space of time — please try again shortly." },
          { status: 429, headers },
        );
      }
      throw err;
    }

    // Already a client? Flip their marketing flag on (DB stays in step with the
    // sheet) and use their real name for the sheet row. Otherwise pass a blank
    // name — upsertMarketingRow appends a plain subscriber row and never blanks
    // an existing contact's name.
    const client = await prisma.client.findFirst({
      where: { email: { equals: cleanEmail, mode: "insensitive" } },
      select: { id: true, name: true, marketing: true },
    });
    if (client && !client.marketing) {
      await prisma.client.update({ where: { id: client.id }, data: { marketing: true } });
    }

    await upsertMarketingRow(client?.name ?? "", cleanEmail, true);

    return NextResponse.json({ ok: true }, { headers });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again, or email phoenix@tanner.me directly." },
      { status: 500, headers },
    );
  }
}
