import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, getSettings, getSpaces } from "@/lib/db";
import { spaceById } from "@/lib/spaces";
import { getBusySpans } from "@/lib/google/calendar";
import { londonDayStart, londonDateKey } from "@/lib/time";
import { isSlotAvailable, resolveWeeklyHours, weeklyHoursFor } from "@/lib/booking/availability";
import type { Clinic } from "@/lib/booking/rules";
import { bookSession } from "@/lib/booking/book";
import { filterBusyForClinic, loadWeeklyCap, loadOverridesForWindow } from "@/lib/booking/slots";
import { sendEmail } from "@/lib/google/gmail";

/** A space that's still bookable — an offer for one since archived has lapsed. */
async function isClinic(v: string): Promise<boolean> {
  return (await getSpaces()).some((s) => s.id === v && s.active);
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
  const space = spaceById(await getSpaces(), clinic);
  const earliest = offeredTimes.reduce((a, b) => (a < b ? a : b));
  const latest = offeredTimes.reduce((a, b) => (a > b ? a : b));
  const windowStart = londonDayStart(-1, earliest);
  const windowEnd = londonDayStart(2, latest);
  const [overrides, busy, weeklyCap] = await Promise.all([
    // Shared loader — picks up repeating windows too, exactly as the /book path does.
    loadOverridesForWindow(clinic, windowStart, windowEnd),
    getBusySpans(windowStart, windowEnd),
    loadWeeklyCap(space, windowStart, windowEnd),
  ]);
  const weeklyHours = weeklyHoursFor(resolveWeeklyHours(settings.weeklyHours), clinic);
  const busySpans = filterBusyForClinic(busy, space, settings);
  return offeredTimes.filter((t) =>
    isSlotAvailable(t, {
      clinic,
      weeklyHours,
      overrides,
      busy: busySpans,
      bufferMinutes: space.bufferMinutes,
      minNoticeMinutes: settings.bookingMinNoticeMins,
      weeklyCap,
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
      !(await isClinic(enquiry.clinic))
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
    if (enquiry.status !== "offered" || !enquiry.clientId || !(await isClinic(enquiry.clinic))) {
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

    const settings = await getSettings();
    const result = await bookSession({
      clientId: enquiry.clientId,
      clinic: enquiry.clinic,
      startISO: start.toISOString(),
      sendEmail: true,
      sendPayment: true,
      // Phoenix is blind-copied on the client's own confirmation rather than
      // sent a second email summarising it.
      notifyOwner: settings.bookingNotifyEmail,
    });

    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "booked" } });
    revalidateTag("shell");

    // The Bcc rides on the client's email, so it only exists if that email
    // sent. When it didn't, the client is booked with nothing in writing and
    // this is the only way Phoenix learns of it.
    if (settings.bookingNotifyEmail && process.env.ALLOWED_EMAIL && !result.emailSent) {
      try {
        await sendEmail(
          process.env.ALLOWED_EMAIL,
          `Booked, but not emailed — ${result.clientName}`,
          [
            `${result.clientName} booked one of the times you offered, and their confirmation email did not go out — they have nothing in writing, so please get in touch directly.`,
            "",
            result.whenLabel,
            result.emailError ? `\nGoogle said: ${result.emailError}` : "",
            "Check Settings › Behind the scenes › Google for the state of the connection.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (err) {
        console.error("Couldn't send the failed-confirmation alert", err);
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
