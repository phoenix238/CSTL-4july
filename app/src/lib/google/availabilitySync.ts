// Two-way sync between the app's "availability offered" (recurring weekly hours
// in AppSettings + one-off AvailabilityOverride rows) and a dedicated Google
// Calendar ("CSTL Availability").
//
// The model: that calendar is a *materialised projection* of the bookable hours
// over a rolling horizon. Every block on it is a concrete dated event the app
// wrote and tagged. Editing is folded back the way the user chose —
//   • add / delete / move a block IN Google → a ONE-OFF change for that date
//     only, expressed through the existing AvailabilityOverride model;
//   • the recurring weekly pattern itself is only ever edited in the app.
//
// Loop-safety rests on two facts recorded per event: an `extendedProperties`
// tag marking it app-authored, and an `AvailabilityEvent` mirror row holding the
// exact window it represents. A pull treats an event as a *user* change only
// when it is untagged (brand new) or tagged-but-its-geometry-no-longer-matches
// its row (moved/resized) — so the app's own writes are always recognised and
// skipped next time round, whatever the sync-token timing.

import { prisma } from "@/lib/db";
import { getCalendarApi, withRetry } from "./client";
import { dayOpenIntervals, resolveWeeklyHours, type OverrideWindow } from "@/lib/booking/availability";
import { loadOverridesForWindow } from "@/lib/booking/slots";
import { CLINIC_EVENT_COLOR, type Clinic } from "@/lib/booking/rules";
import { londonAddDays, londonDayStart, londonDateKey, londonTime } from "@/lib/time";
import {
  AVAIL_HORIZON_DAYS,
  canonicalSummary,
  clinicFromTitle,
  expectedWindows,
  geometryOf,
  keyOf,
  weekdayOf,
  windowInstants,
} from "./availabilityProjection";

const TZ = "Europe/London";

type CalendarApi = Awaited<ReturnType<typeof getCalendarApi>>;

/** An event on the availability calendar, as it comes back from Google. */
interface CalItem {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  extendedProperties?: { private?: Record<string, string> | null } | null;
}

// ————————————————————————————————————————————————————————————————
// Settings access — read straight from the DB, never the request-cached
// getSettings(): this module both writes settings (calendar id, sync token,
// watermark) and re-reads them within the same request (connect → sync), and a
// cached read would miss its own just-written values.
// ————————————————————————————————————————————————————————————————
function loadSettings() {
  return prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
}

// ————————————————————————————————————————————————————————————————
// Connect
// ————————————————————————————————————————————————————————————————

/** Create the dedicated "CSTL Availability" calendar if it isn't connected yet. */
export async function ensureAvailabilityCalendar(): Promise<string> {
  const settings = await loadSettings();
  if (settings.availabilityCalendarId) return settings.availabilityCalendarId;
  const calendar = await getCalendarApi();
  const res = await withRetry(() =>
    calendar.calendars.insert({
      requestBody: {
        summary: "CSTL Availability",
        description:
          "Bookable hours you've offered to clients — kept in two-way sync with the CSTL Control Tower. " +
          "Add, move or delete a block here and it updates the app (for that date); change your hours in the app and they update here.",
        timeZone: TZ,
      },
    }),
  );
  const id = res.data.id!;
  await prisma.appSettings.update({
    where: { id: 1 },
    data: { availabilityCalendarId: id, availabilityCalendarSyncToken: "" },
  });
  return id;
}

// ————————————————————————————————————————————————————————————————
// App → Google: project the availability config onto the calendar
// ————————————————————————————————————————————————————————————————

/**
 * Bring the availability calendar in line with the app's current bookable hours
 * over the window (default: the rolling horizon). A geometry-keyed diff against
 * the `AvailabilityEvent` mirror: insert events for windows not yet on the
 * calendar, delete events for windows no longer offered. A moved/resized window
 * is simply an old key gone + a new key added. Idempotent — safe to run on every
 * availability change and from the cron.
 */
export async function projectAvailabilityToCalendar(window?: {
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ inserted: number; deleted: number }> {
  const settings = await loadSettings();
  if (!settings.availabilityCalendarId) return { inserted: 0, deleted: 0 };
  const windowStart = window?.windowStart ?? londonDayStart(0);
  const windowEnd = window?.windowEnd ?? londonDayStart(AVAIL_HORIZON_DAYS);

  const weeklyHours = resolveWeeklyHours(settings.weeklyHours);
  const [waterlooOv, bethnalOv] = await Promise.all([
    loadOverridesForWindow("waterloo", windowStart, windowEnd),
    loadOverridesForWindow("bethnal", windowStart, windowEnd),
  ]);
  const overridesByClinic = { waterloo: waterlooOv, bethnal: bethnalOv };
  const expected = expectedWindows({ weeklyHours, overridesByClinic, windowStart, windowEnd });
  const expectedByKey = new Map(expected.map((w) => [keyOf(w), w]));

  const startKey = londonDateKey(windowStart);
  const endKey = londonDateKey(windowEnd);
  const rows = await prisma.availabilityEvent.findMany({ where: { dateKey: { gte: startKey, lt: endKey } } });
  const rowByKey = new Map(rows.map((r) => [keyOf(r), r]));

  const calendar = await getCalendarApi();
  const calId = settings.availabilityCalendarId;
  let inserted = 0;
  let deleted = 0;

  // Insert windows the calendar doesn't have yet.
  for (const [k, w] of expectedByKey) {
    if (rowByKey.has(k)) continue;
    const { start, end } = windowInstants(w.dateKey, w.startMin, w.endMin);
    const res = await withRetry(() =>
      calendar.events.insert({
        calendarId: calId,
        requestBody: {
          summary: canonicalSummary(w.clinic),
          colorId: CLINIC_EVENT_COLOR[w.clinic],
          // An overlay for planning — must never mark Phoenix busy, and stays out
          // of the bookable-slot engine (which only reads personal/room/chalkFarm).
          transparency: "transparent",
          start: { dateTime: start.toISOString(), timeZone: TZ },
          end: { dateTime: end.toISOString(), timeZone: TZ },
          extendedProperties: { private: { cstlAvailability: "1", cstlClinic: w.clinic } },
        },
      }),
    );
    const oneOffOpen = overridesByClinic[w.clinic].some(
      (o) => o.kind === "open" && !o.repeatWeekly && o.date === w.dateKey && o.startMin <= w.startMin && o.endMin >= w.endMin,
    );
    await prisma.availabilityEvent.create({
      data: {
        eventId: res.data.id!,
        clinic: w.clinic,
        dateKey: w.dateKey,
        startMin: w.startMin,
        endMin: w.endMin,
        source: oneOffOpen ? "override" : "weekly",
      },
    });
    inserted++;
  }

  // Delete events for windows no longer offered.
  for (const [k, r] of rowByKey) {
    if (expectedByKey.has(k)) continue;
    await deleteEvent(calendar, calId, r.eventId);
    await prisma.availabilityEvent.delete({ where: { eventId: r.eventId } }).catch(() => {});
    deleted++;
  }

  return { inserted, deleted };
}

async function deleteEvent(calendar: CalendarApi, calId: string, eventId: string) {
  try {
    await withRetry(() => calendar.events.delete({ calendarId: calId, eventId }));
  } catch (err: unknown) {
    const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
    if (status !== 404 && status !== 410) throw err; // already gone — fine
  }
}

// ————————————————————————————————————————————————————————————————
// Google → App: fold calendar edits back into overrides (that date only)
// ————————————————————————————————————————————————————————————————

/**
 * Close a window on one date: retract any one-off open overrides that cover it,
 * then — if weekly hours or a repeating override still leave that window open —
 * lay a one-off block over it. Fully closes the window for that date regardless
 * of where the open time came from, and is idempotent (a second run finds
 * nothing to retract and the window already blocked).
 */
async function closeWindowOnDate(clinic: Clinic, dateKey: string, startMin: number, endMin: number) {
  const openOverrides = await prisma.availabilityOverride.findMany({
    where: { clinic, date: dateKey, kind: "open", repeatWeekly: false },
  });
  const overlapping = openOverrides.filter((o) => o.startMin < endMin && o.endMin > startMin);
  if (overlapping.length) {
    await prisma.availabilityOverride.deleteMany({ where: { id: { in: overlapping.map((o) => o.id) } } });
  }

  const settings = await loadSettings();
  const weeklyHours = resolveWeeklyHours(settings.weeklyHours)[clinic];
  const overrides = await overridesForDate(clinic, dateKey);
  const intervals = dayOpenIntervals(weekdayOf(dateKey), dateKey, weeklyHours, overrides);
  const stillOpen = intervals.some((iv) => iv.start < endMin && iv.end > startMin);
  if (stillOpen) {
    await prisma.availabilityOverride.create({
      data: { clinic, date: dateKey, kind: "block", startMin, endMin, repeatWeekly: false, exactStart: false, note: "" },
    });
  }
}

/**
 * Open a window on one date as a one-off: clear any one-off block overlapping it
 * (in case the user is re-opening time they'd closed), then add a one-off open
 * override. Returns the override id so the triggering event can be adopted to it.
 */
async function openWindowOnDate(clinic: Clinic, dateKey: string, startMin: number, endMin: number): Promise<string> {
  const blocks = await prisma.availabilityOverride.findMany({
    where: { clinic, date: dateKey, kind: "block", repeatWeekly: false },
  });
  const overlapping = blocks.filter((b) => b.startMin < endMin && b.endMin > startMin);
  if (overlapping.length) {
    await prisma.availabilityOverride.deleteMany({ where: { id: { in: overlapping.map((b) => b.id) } } });
  }
  const created = await prisma.availabilityOverride.create({
    data: { clinic, date: dateKey, kind: "open", startMin, endMin, repeatWeekly: false, exactStart: false, note: "" },
  });
  return created.id;
}

/** Overrides that apply to one clinic on one date (repeatWeekly-aware). */
async function overridesForDate(clinic: Clinic, dateKey: string): Promise<OverrideWindow[]> {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dayStart = londonTime(y, m, d, 0, 0);
  const dayEnd = londonAddDays(dayStart, 1);
  return loadOverridesForWindow(clinic, dayStart, dayEnd);
}

/**
 * Pull changes off the availability calendar and fold them back into overrides.
 * Incremental via a stored sync token; a stale token (410) forces a full resync.
 */
export async function pullAvailabilityFromCalendar(): Promise<{ imported: number; closed: number; moved: number }> {
  const settings = await loadSettings();
  if (!settings.availabilityCalendarId) return { imported: 0, closed: 0, moved: 0 };
  const calendar = await getCalendarApi();
  const calId = settings.availabilityCalendarId;
  const windowStart = londonDayStart(0);
  const windowEnd = londonDayStart(AVAIL_HORIZON_DAYS);

  const { items, nextSyncToken } = await listChanges(
    calendar,
    calId,
    settings.availabilityCalendarSyncToken,
    windowStart,
    windowEnd,
  );

  let imported = 0;
  let closed = 0;
  let moved = 0;

  for (const ev of items) {
    if (!ev.id) continue;
    const managed = ev.extendedProperties?.private?.cstlAvailability === "1";
    const row = await prisma.availabilityEvent.findUnique({ where: { eventId: ev.id } });

    if (ev.status === "cancelled") {
      // A managed event the user deleted → close that window for that date.
      // (An unmanaged deletion, or our own delete whose row we already dropped,
      // has no row and is nothing to do.)
      if (row) {
        await closeWindowOnDate(row.clinic as Clinic, row.dateKey, row.startMin, row.endMin);
        await prisma.availabilityEvent.delete({ where: { eventId: ev.id } }).catch(() => {});
        closed++;
      }
      continue;
    }

    const geom = geometryOf(ev.start?.dateTime, ev.end?.dateTime);
    if (!geom) continue; // all-day / malformed — ignored

    if (managed && row) {
      const unchanged = row.dateKey === geom.dateKey && row.startMin === geom.startMin && row.endMin === geom.endMin;
      if (unchanged) continue; // our own write, or nothing changed — the loop guard
      // Moved / resized: close the old window, open the new one (that date only).
      await closeWindowOnDate(row.clinic as Clinic, row.dateKey, row.startMin, row.endMin);
      const clinic = clinicFromTitle(ev.summary, row.clinic as Clinic);
      await openWindowOnDate(clinic, geom.dateKey, geom.startMin, geom.endMin);
      await prisma.availabilityEvent.delete({ where: { eventId: ev.id } }).catch(() => {});
      moved++;
      continue;
    }

    if (!managed) {
      // A brand-new event the user drew → import as a one-off open block, then
      // adopt the event (tag + canonical title/colour) so it isn't re-imported.
      const clinic = clinicFromTitle(ev.summary, settings.availabilityDefaultClinic as Clinic);
      const overrideId = await openWindowOnDate(clinic, geom.dateKey, geom.startMin, geom.endMin);
      await adoptEvent(calendar, calId, ev.id, clinic, geom, overrideId);
      imported++;
    }
    // managed but no row (row lost): leave it — projection will reconcile it.
  }

  await prisma.appSettings.update({
    where: { id: 1 },
    data: { availabilityCalendarSyncToken: nextSyncToken ?? "" },
  });
  return { imported, closed, moved };
}

/** Tag a user-drawn event as app-managed and record its mirror row. */
async function adoptEvent(
  calendar: CalendarApi,
  calId: string,
  eventId: string,
  clinic: Clinic,
  geom: { dateKey: string; startMin: number; endMin: number },
  overrideId: string,
) {
  await withRetry(() =>
    calendar.events.patch({
      calendarId: calId,
      eventId,
      requestBody: {
        summary: canonicalSummary(clinic),
        colorId: CLINIC_EVENT_COLOR[clinic],
        transparency: "transparent",
        extendedProperties: { private: { cstlAvailability: "1", cstlClinic: clinic } },
      },
    }),
  );
  await prisma.availabilityEvent.upsert({
    where: { eventId },
    create: { eventId, clinic, dateKey: geom.dateKey, startMin: geom.startMin, endMin: geom.endMin, source: "override", overrideId },
    update: { clinic, dateKey: geom.dateKey, startMin: geom.startMin, endMin: geom.endMin, source: "override", overrideId },
  });
}

/**
 * List changed events. With a stored sync token, Google returns only what's
 * changed since (deletions included, as status:"cancelled"); without one, a
 * windowed list seeds the token. A 410 means the token is too old — start over
 * with a full resync.
 */
async function listChanges(
  calendar: CalendarApi,
  calId: string,
  syncToken: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ items: CalItem[]; nextSyncToken?: string }> {
  const items: CalItem[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const base = syncToken
    ? { calendarId: calId, singleEvents: true, syncToken, maxResults: 250 }
    : {
        calendarId: calId,
        singleEvents: true,
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        maxResults: 250,
      };
  try {
    do {
      const res = await calendar.events.list({ ...base, pageToken });
      items.push(...((res.data.items ?? []) as CalItem[]));
      pageToken = res.data.nextPageToken ?? undefined;
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
    if (status === 410 && syncToken) {
      // Token expired — drop it and re-list the window from scratch.
      return listChanges(calendar, calId, "", windowStart, windowEnd);
    }
    throw err;
  }
  return { items, nextSyncToken };
}

// ————————————————————————————————————————————————————————————————
// Orchestration
// ————————————————————————————————————————————————————————————————

/** Pull first (fold Google edits back), then project (push app state out). */
export async function runAvailabilitySync(): Promise<{
  connected: boolean;
  imported?: number;
  closed?: number;
  moved?: number;
  inserted?: number;
  deleted?: number;
}> {
  const settings = await loadSettings();
  if (!settings.availabilityCalendarId) return { connected: false };
  const pulled = await pullAvailabilityFromCalendar();
  const projected = await projectAvailabilityToCalendar();
  await prisma.appSettings.update({ where: { id: 1 }, data: { availabilityLastSyncAt: new Date() } });
  return { connected: true, ...pulled, ...projected };
}
