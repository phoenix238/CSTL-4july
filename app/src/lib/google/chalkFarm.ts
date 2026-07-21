import { prisma, getSettings } from "@/lib/db";
import { getCalendarApi } from "./client";
import { EVENT_REMINDERS } from "@/lib/booking/rules";
import { londonDayStart, londonTime } from "@/lib/time";

const TZ = "Europe/London";

/** 404/410 from a delete/patch — the event's already gone on Google's side. */
function isGone(err: unknown): boolean {
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  return status === 404 || status === 410;
}

/**
 * Keep the single shared "Phoenix" Chalk Farm room block for one day in sync
 * with that day's actual confirmed Bethnal Green bookings. The block grows or
 * shrinks to span from the earliest session's start to the latest session's
 * end — no fixed padding — so sessions can sit as close together as the
 * schedule allows. Deletes the block once no Bethnal sessions remain that day.
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

  const blockStart = new Date(Math.min(...bookings.map((b) => b.startsAt.getTime())));
  const blockEnd = new Date(Math.max(...bookings.map((b) => b.startsAt.getTime() + 60 * 60_000)));
  const requestBody = {
    summary: "Phoenix",
    start: { dateTime: blockStart.toISOString(), timeZone: TZ },
    end: { dateTime: blockEnd.toISOString(), timeZone: TZ },
    reminders: EVENT_REMINDERS,
  };

  if (existing) {
    try {
      await calendar.events.patch({ calendarId: calId, eventId: existing.eventId, requestBody });
      return;
    } catch (err) {
      if (!isGone(err)) throw err;
      // vanished on Google's side — fall through and recreate below
    }
  }

  const res = await calendar.events.insert({ calendarId: calId, requestBody });
  await prisma.chalkFarmDayBlock.upsert({
    where: { date: dateKey },
    update: { eventId: res.data.id! },
    create: { date: dateKey, eventId: res.data.id! },
  });
}
