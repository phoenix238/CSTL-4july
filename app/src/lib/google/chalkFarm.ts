import { prisma, getSettings } from "@/lib/db";
import { getCalendarApi, withRetry } from "./client";
import { EVENT_REMINDERS, NO_REMINDERS } from "@/lib/booking/rules";
import { clusterSessions } from "@/lib/booking/availability";
import { fmtTime, londonDayStart, londonTime } from "@/lib/time";

const TZ = "Europe/London";
const SESSION_MS = 60 * 60_000;

/** 404/410 from a delete/patch — the event's already gone on Google's side. */
function isGone(err: unknown): boolean {
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  return status === 404 || status === 410;
}

/**
 * The [start, end) each shared Chalk Farm block should span for one day's
 * confirmed Bethnal session start times. Sessions close together (within
 * `clusterGapMinutes` of each other) share one block; a wider gap starts a new
 * block, so two sessions hours apart get two separate blocks rather than one
 * that holds the empty time between them. Each block runs from
 * `edgeBufferMinutes` before its earliest session to the same after its latest
 * session's end, and carries that cluster's own session starts for the
 * venue-facing note. Pure — split out from `syncChalkFarmDayBlock` so the
 * clustering + edge-padding math is unit-testable without mocking Prisma/Google.
 */
export function chalkFarmBlockRanges(
  sessionStarts: Date[],
  edgeBufferMinutes: number,
  clusterGapMinutes: number,
): Array<{ start: Date; end: Date; starts: Date[] }> {
  const edgeBufferMs = edgeBufferMinutes * 60_000;
  const clusters = clusterSessions(
    sessionStarts.map((t) => t.getTime()),
    SESSION_MS,
    clusterGapMinutes * 60_000,
  );
  return clusters.map((ms) => ({
    start: new Date(ms[0] - edgeBufferMs),
    end: new Date(ms[ms.length - 1] + SESSION_MS + edgeBufferMs),
    starts: ms.map((t) => new Date(t)),
  }));
}

/**
 * Keep the shared "Phoenix" Chalk Farm room blocks for one day in sync with
 * that day's actual confirmed Bethnal Green bookings. A run of sessions close
 * together shares one block (spanning from `chalkFarmEdgeBufferMinutes` before
 * its first to the same after its last); sessions more than
 * `chalkFarmClusterGapMinutes` apart get separate blocks, so a big gap between
 * two clients isn't held as room time. Existing blocks are patched to the new
 * ranges, extra ones deleted, missing ones inserted; all are removed once no
 * Bethnal sessions remain that day.
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
  // Old rows (before day-blocks could cluster) carry a single `eventId`; new
  // rows carry the full `eventIds` list. Absorb either, so an existing block is
  // reused/cleaned up rather than orphaned on Google when the model changes.
  const existingIds = existing
    ? existing.eventIds.length
      ? existing.eventIds
      : existing.eventId
        ? [existing.eventId]
        : []
    : [];
  const calendar = await getCalendarApi();

  const removeEvents = async (ids: string[]) => {
    for (const eventId of ids) {
      try {
        await calendar.events.delete({ calendarId: calId, eventId });
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
  };

  if (bookings.length === 0) {
    if (existing) {
      await removeEvents(existingIds);
      await prisma.chalkFarmDayBlock.delete({ where: { date: dateKey } });
    }
    return;
  }

  const ranges = chalkFarmBlockRanges(
    bookings.map((b) => b.startsAt),
    settings.chalkFarmEdgeBufferMinutes,
    settings.chalkFarmClusterGapMinutes,
  );

  const eventIds: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    // Venue-facing note per block: how many sessions in this cluster, when each
    // starts, when it finishes, and how to reach Phoenix — no client names on
    // the shared calendar.
    const startTimes = range.starts.map((t) => fmtTime(t));
    const n = range.starts.length;
    const description = [
      `${n} session${n === 1 ? "" : "s"}: ${startTimes.join(", ")} · finishes ${fmtTime(range.end)}`,
      settings.clinicContactLine.trim(),
    ]
      .filter(Boolean)
      .join("\n");

    const requestBody = {
      summary: "Phoenix",
      description,
      start: { dateTime: range.start.toISOString(), timeZone: TZ },
      end: { dateTime: range.end.toISOString(), timeZone: TZ },
      // Venue-facing block — only carries Phoenix's reminders when he's opted
      // venue events in, so a Bethnal session doesn't remind him twice (once
      // here, once on his personal session event).
      reminders: settings.venueReminders ? EVENT_REMINDERS : NO_REMINDERS,
    };

    // Reuse the i-th existing block where there is one; otherwise insert a fresh
    // event. A reused id that's vanished on Google's side falls through to insert.
    const reuseId = existingIds[i];
    let resultId = "";
    if (reuseId) {
      try {
        await withRetry(() => calendar.events.patch({ calendarId: calId, eventId: reuseId, requestBody }));
        resultId = reuseId;
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
    if (!resultId) {
      const res = await withRetry(() => calendar.events.insert({ calendarId: calId, requestBody }));
      resultId = res.data.id!;
    }
    eventIds.push(resultId);
  }

  // More blocks yesterday than today (sessions moved together, or some
  // cancelled) — delete the now-surplus events so none are left orphaned.
  await removeEvents(existingIds.slice(ranges.length));

  await prisma.chalkFarmDayBlock.upsert({
    where: { date: dateKey },
    update: { eventIds, eventId: eventIds[0] ?? "" },
    create: { date: dateKey, eventIds, eventId: eventIds[0] ?? "" },
  });
}
