import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings } from "@/lib/db";
import { getBusySpans } from "@/lib/google/calendar";
import { londonDayStart, londonDateKey } from "@/lib/time";
import { isSlotAvailable, resolveWeeklyHours } from "@/lib/booking/availability";
import type { Clinic } from "@/lib/booking/rules";
import { bookSession } from "@/lib/booking/book";
import { sendEmail } from "@/lib/google/gmail";

function isClinic(v: string): v is Clinic {
  return v === "waterloo" || v === "bethnal";
}

/**
 * Which of these already-offered times are still genuinely free right now?
 * Checked directly against open hours + live busy spans (not the public
 * `/book` page's `slotMinutes`-stepped grid) — an offered time was hand-picked
 * from the admin calendar's finer 15-min steps and may fall between grid
 * points, so exact membership in that grid isn't the right test here.
 */
async function stillFreeOfferedTimes(clinic: Clinic, offeredTimes: Date[]): Promise<Date[]> {
  if (!offeredTimes.length) return [];
  const settings = await getSettings();
  const earliest = offeredTimes.reduce((a, b) => (a < b ? a : b));
  const latest = offeredTimes.reduce((a, b) => (a > b ? a : b));
  const windowStart = londonDayStart(-1, earliest);
  const windowEnd = londonDayStart(2, latest);
  const [overrides, busy] = await Promise.all([
    prisma.availabilityOverride.findMany({
      where: { clinic, date: { gte: londonDateKey(windowStart), lt: londonDateKey(windowEnd) } },
    }),
    getBusySpans(windowStart, windowEnd),
  ]);
  const weeklyHours = resolveWeeklyHours(settings.weeklyHours)[clinic];
  const busySpans = busy
    .filter((b) => !b.roomBlock)
    .map((b) => ({ ...b, bufferMinutes: b.source === "chalkFarm" ? settings.chalkFarmBufferMinutes : undefined }));
  return offeredTimes.filter((t) =>
    isSlotAvailable(t, {
      clinic,
      weeklyHours,
      overrides: overrides.map((o) => ({
        date: o.date,
        kind: o.kind as "open" | "block",
        startMin: o.startMin,
        endMin: o.endMin,
      })),
      busy: busySpans,
      bufferMinutes: settings.bookingBufferMinutes,
      minNoticeMinutes: settings.bookingMinNoticeMins,
    }),
  );
}

// NOT guarded — public, token-gated. The token is the authorization: a client
// can only reach this by clicking the link they were personally emailed.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const enquiry = token ? await prisma.enquiry.findFirst({ where: { offerToken: token } }) : null;
    if (!enquiry) return NextResponse.json({ error: "expired" }, { status: 404 });
    if (enquiry.status === "booked") return NextResponse.json({ status: "booked" });
    if (
      enquiry.status !== "offered" ||
      !enquiry.offeredTimes.length ||
      !enquiry.clientId ||
      !isClinic(enquiry.clinic)
    ) {
      return NextResponse.json({ error: "expired" }, { status: 404 });
    }

    const client = await prisma.client.findUnique({ where: { id: enquiry.clientId } });
    const freeTimes = await stillFreeOfferedTimes(enquiry.clinic, enquiry.offeredTimes);
    return NextResponse.json({
      status: "offered",
      clientName: client?.name ?? "",
      clinic: enquiry.clinic,
      offeredTimes: enquiry.offeredTimes.map((t) => t.toISOString()),
      freeTimes: freeTimes.map((t) => t.toISOString()),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't load this offer" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { startISO, company } = (await req.json()) as { startISO?: string; company?: string };

    if (company?.trim()) {
      // Bot filled the hidden field — reject quietly, no booking attempted.
      return NextResponse.json({ error: "Something went wrong" }, { status: 400 });
    }

    const enquiry = token ? await prisma.enquiry.findFirst({ where: { offerToken: token } }) : null;
    if (!enquiry || enquiry.status === "booked") {
      return NextResponse.json({ error: "expired" }, { status: 404 });
    }
    if (enquiry.status !== "offered" || !enquiry.clientId || !isClinic(enquiry.clinic)) {
      return NextResponse.json({ error: "expired" }, { status: 404 });
    }

    const start = startISO ? new Date(startISO) : null;
    if (!start || Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: "Invalid time" }, { status: 400 });
    }
    const wasOffered = enquiry.offeredTimes.some((t) => t.getTime() === start.getTime());
    if (!wasOffered) {
      return NextResponse.json({ error: "That time wasn't one of the offered slots." }, { status: 400 });
    }

    // Re-verify: something else (a manual booking, another enquiry) may have
    // taken this exact time since it was offered — never trust the stored list blindly.
    const stillFree = await stillFreeOfferedTimes(enquiry.clinic, [start]);
    if (!stillFree.length) {
      return NextResponse.json(
        { error: "That time isn't available anymore — please pick another, or get in touch with Phoenix directly." },
        { status: 409 },
      );
    }

    const result = await bookSession({
      clientId: enquiry.clientId,
      clinic: enquiry.clinic,
      startISO: start.toISOString(),
      sendEmail: true,
      sendPayment: true,
    });

    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "booked" } });
    revalidateTag("shell");

    const settings = await getSettings();
    if (settings.bookingNotifyEmail && process.env.ALLOWED_EMAIL) {
      try {
        await sendEmail(
          process.env.ALLOWED_EMAIL,
          `New booking — ${result.clientName}`,
          `${result.clientName} just booked one of the times you offered.\n\n${result.whenLabel}\n\nBooked via your offer link — nothing left to confirm.`,
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
