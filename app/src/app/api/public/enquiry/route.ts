import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";
import { isValidEmail } from "@/lib/validate";
import { assertBookingAllowed, RateLimitedError } from "@/lib/booking/rateLimit";
import { sendEmail } from "@/lib/google/gmail";

/**
 * Cross-origin by design — this is called from craniosacraltherapylondon.com's
 * own contact form (assets/track.js), a different origin to this app, plus the
 * local dev server and the GitHub Pages branch preview used while working on
 * that site. Not a public API for arbitrary origins: everything else is
 * refused, matching the narrow trust model of the other /api/public routes.
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

// Public — this is the site's contact form. Authorization model: honeypot +
// the same shared rate limiter as /api/public/book (same email/IP ceilings;
// a person's enquiries and bookings drawing from one shared allowance is the
// right shape for a solo practice, not a gap).
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));

  try {
    const body = await req.json();
    const { name, email, phone, message, company, page } = body as {
      name?: string;
      email?: string;
      phone?: string;
      message?: string;
      company?: string; // honeypot
      page?: string; // which page on the site the visitor came from
    };

    if (company?.trim()) {
      // Bot filled the hidden field — reject quietly, no enquiry recorded.
      return NextResponse.json({ error: "Something went wrong" }, { status: 400, headers });
    }

    const cleanName = name?.trim() ?? "";
    if (!cleanName || cleanName.length > 200) {
      return NextResponse.json({ error: "Please add your name" }, { status: 400, headers });
    }
    const cleanEmail = email?.trim() ?? "";
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return NextResponse.json({ error: "Please add a valid email" }, { status: 400, headers });
    }
    const cleanMessage = message?.trim() ?? "";
    if (!cleanMessage || cleanMessage.length > 4000) {
      return NextResponse.json({ error: "Please add a short message" }, { status: 400, headers });
    }
    const cleanPhone = phone?.trim() ?? "";
    const cleanPage = page?.trim().slice(0, 200) || "unknown page";

    try {
      await assertBookingAllowed(req, cleanEmail);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        // The class's own message talks about "bookings" — right for /book,
        // wrong for a contact form sharing its ceiling. Same limit, different
        // words for where it's actually being hit.
        return NextResponse.json(
          {
            error:
              "That's several messages in a short space of time. If it's urgent, please WhatsApp or call Phoenix directly.",
          },
          { status: 429, headers },
        );
      }
      throw err;
    }

    // Claude reads name/phone/email straight out of pasted text, same as the
    // Gmail add-on route — feeding it the message here is only to surface a
    // clinic guess in the enquiry inbox. Non-fatal: a parsing hiccup must
    // never lose a real enquiry.
    const text = `From: ${cleanName} <${cleanEmail}>\nPhone: ${cleanPhone}\nPage: ${cleanPage}\n\n${cleanMessage}`;
    let clinicSuggestion = "";
    try {
      const analysis = await analyseEnquiry(text);
      clinicSuggestion = analysis.clinicSuggestion ?? "";
    } catch (err) {
      console.error("Couldn't analyse enquiry — saving it without a clinic guess", err);
    }

    const enquiry = await prisma.enquiry.create({
      data: {
        text,
        name: cleanName,
        via: "WEB",
        status: "waiting",
        clinic: clinicSuggestion,
      },
    });
    revalidateTag("shell");

    // Best-effort notification. The enquiry is already saved above — Phoenix
    // still sees it in the inbox even if this fails, so a Gmail hiccup here
    // must never turn into a lost enquiry for the visitor.
    if (process.env.ALLOWED_EMAIL) {
      try {
        await sendEmail(
          process.env.ALLOWED_EMAIL,
          `New enquiry — ${cleanPage}`,
          [
            `${cleanName} sent a message from the website (${cleanPage}).`,
            "",
            cleanMessage,
            "",
            `Reply directly to this email to reach them at ${cleanEmail}.`,
            cleanPhone ? `Phone: ${cleanPhone}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          undefined,
          undefined,
          { replyTo: cleanEmail },
        );
      } catch (err) {
        console.error("Couldn't send the enquiry notification email", err);
      }
    }

    return NextResponse.json({ id: enquiry.id }, { headers });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again, or WhatsApp Phoenix directly." },
      { status: 500, headers },
    );
  }
}
