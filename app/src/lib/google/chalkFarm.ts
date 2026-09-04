import { prisma, getSettings } from "@/lib/db";
import { getCalendarApi, withRetry } from "./client";
import { EVENT_REMINDERS, NO_REMINDERS } from "@/lib/booking/rules";
import { fmtTime, londonDayStart, londonTime } from "@/lib/time";

const TZ = "Europe/London";

/** 404/410 from a delete/patch — the event's already gone on Google's side. */
function isGone(err: unknown): boolean {
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  return status === 404 || status === 410;
}

/**
 * The [start, end) the shared Chalk Farm block should span for one day's
 * confirmed Bethnal session start times: `edgeBufferMinutes` before the
 * earliest and the same amount after the latest session's end. Pure — split
 * out from `syncChalkFarmDayBlock` so the edge-padding math is unit-testable
 * without mocking Prisma/Google.
 */
export function chalkFarmBlockRange(sessionStarts: Date[], edgeBufferMinutes: number): { start: Date; end: Date } {
  const edgeBufferMs = edgeBufferMinutes * 60_000;
  return {
    start: new Date(Math.min(...sessionStarts.map((t) => t.getTime())) - edgeBufferMs),
    end: new Date(Math.max(...sessionStarts.map((t) => t.getTime() + 60 * 60_000)) + edgeBufferMs),
  };
}

/**
 * Keep the single shared "Phoenix" Chalk Farm room block for one day in sync
 * with that day's actual confirmed Bethnal Green bookings. The block grows or
 * shrinks to span from `chalkFarmEdgeBufferMinutes` before the earliest
 * session's start to the same amount after the latest session's end — so
 * studio-mates on the shared calendar see clearance before the first client
 * and after the last one, without a fixed gap between sessions in between
 * (those sit as close together as the schedule allows). Deletes the block
 * once no Bethnal sessions remain that day.
 */
export async function syncChalkFarmDayBlock(dateKey: string) {
  const settings = await getSettings();
  const calId = settings.chalkFarmCalendarId;
  if (!calId) return; // not configured yet — nothing to sync

  const [y, m, d] = dateKey.split("-").map(Number);
  const dayStart = londonTime(y, m, d, 0, 0);
  const dayEnd = londonDayStart(1, dayStart);

  const bookings = await prisma.booking.findMany({
    where: { clinic: "bethnal", status: "confirmed", startsAt: { gte: dayStart, lt: dayEnd } },
  });

  const existing = await prisma.chalkFarmDayBlock.findUnique({ where: { date: dateKey } });
  const calendar = await getCalendarApi();

  if (bookings.length === 0) {
    if (existing) {
      try {
        await calendar.events.delete({ calendarId: calId, eventId: existing.eventId });
      } catch (err) {
        if (!isGone(err)) throw err;
      }
      await prisma.chalkFarmDayBlock.delete({ where: { date: dateKey } });
    }
    return;
  }

  const { start: blockStart, end: blockEnd } = chalkFarmBlockRange(
    bookings.map((b) => b.startsAt),
    settings.chalkFarmEdgeBufferMinutes,
  );

  // Venue-facing note: how many sessions, when each one starts, when the day
  // finishes, and how to reach Phoenix — without any client names on the shared
  // Chalk Farm calendar.
  const startTimes = bookings
    .map((b) => b.startsAt.getTime())
    .sort((a, b) => a - b)
    .map((t) => fmtTime(new Date(t)));
  const n = bookings.length;
  const description = [
    `${n} session${n === 1 ? "" : "s"}: ${startTimes.join(", ")} · finishes ${fmtTime(blockEnd)}`,
    settings.clinicContactLine.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const requestBody = {
    summary: "Phoenix",
    description,
    start: { dateTime: blockStart.toISOString(), timeZone: TZ },
    end: { dateTime: blockEnd.toISOString(), timeZone: TZ },
    // The shared block is venue-facing — it only carries Phoenix's reminders when
    // he's opted venue events in, so a Bethnal session doesn't remind him twice
    // (once here, once on his personal session event).
    reminders: settings.venueReminders ? EVENT_REMINDERS : NO_REMINDERS,
  };

  if (existing) {
    try {
      await withRetry(() => calendar.events.patch({ calendarId: calId, eventId: existing.eventId, requestBody }));
      return;
    } catch (err) {
      if (!isGone(err)) throw err;
      // vanished on Google's side — fall through and recreate below
    }
  }

  const res = await withRetry(() => calendar.events.insert({ calendarId: calId, requestBody }));
  await prisma.chalkFarmDayBlock.upsert({
    where: { date: dateKey },
    update: { eventId: res.data.id! },
    create: { date: dateKey, eventId: res.data.id! },
  });
}
