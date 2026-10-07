// Pure layout + colour logic for the calendar grids — no React, unit-tested.

import type { Clinic } from "@/lib/booking/rules";
import type { Space } from "@/lib/spaces";

/** Where a span came from: a booking, one of your spaces' venue calendars, or your own calendar. */
export type SpanSource = "booking" | "venue" | "personal";

/** BusySpan as it arrives over the wire (dates are ISO strings). */
export interface SpanDTO {
  start: string;
  end: string;
  title: string;
  known: boolean;
  source: SpanSource;
  clientId?: string;
  bookingId?: string;
  clinic?: Clinic;
  /** Google's event id — present on real Google events, enables edit/delete. */
  googleEventId?: string;
  /** true for a space's shared venue day block — visible, but ignored by
   * availability/collision checks (only real sessions block time). */
  roomBlock?: boolean;
}

export const SPAN_COLORS: Record<
  SpanSource,
  { label: string; bg: string; border: string; text: string }
> = {
  booking: {
    label: "Booked session",
    bg: "oklch(0.94 0.03 48)",
    border: "oklch(0.58 0.115 42)",
    text: "oklch(0.42 0.1 42)",
  },
  venue: {
    label: "Venue calendars",
    bg: "oklch(0.95 0.035 85)",
    border: "oklch(0.62 0.1 78)",
    text: "oklch(0.5 0.09 75)",
  },
  personal: {
    label: "Google Calendar",
    bg: "oklch(0.94 0.01 80)",
    border: "oklch(0.75 0.02 70)",
    text: "oklch(0.45 0.02 60)",
  },
};

/**
 * A venue calendar that holds shared day blocks is drawn green rather than the
 * venue amber, so a block reads differently from a per-session room booking.
 */
const VENUE_DAY_BLOCK_COLOR = {
  bg: "oklch(0.94 0.03 148)",
  border: "oklch(0.62 0.13 148)",
  text: "oklch(0.42 0.08 148)",
};

/** The colours one span is drawn in — its source's, with day-block venues in green. */
export function spanColors(span: Pick<SpanDTO, "source" | "clinic">, spaces: Space[]) {
  const base = SPAN_COLORS[span.source] ?? SPAN_COLORS.personal;
  if (span.source === "venue" && spaces.find((s) => s.id === span.clinic)?.venueMode === "dayBlock") {
    return { ...base, ...VENUE_DAY_BLOCK_COLOR };
  }
  return base;
}

/** Space id an availability window belongs to. */
export type AvailClinic = Clinic;

/**
 * One availability window drawn on the calendar.
 *
 * Two different things are shown, deliberately layered:
 *  - `weekly` (faint) is the hours you *intended* — straight from Settings.
 *  - `bookable` (solid) is what a client can *actually* book right now,
 *    computed by the same code as the public /book page.
 * The gap between them is the point: it's where a calendar event, a buffer,
 * the notice window or the weekly cap has quietly closed time you thought was
 * open. `open`/`block` are one-off date overrides you draw on the grid and can
 * edit or remove — `id` is their AvailabilityOverride row id.
 */
export interface AvailWindowDTO {
  id?: string;
  clinic: AvailClinic;
  date: string; // "YYYY-MM-DD" (London)
  kind: "open" | "block" | "weekly" | "bookable";
  startMin: number;
  endMin: number;
  /** an "open"/"block" window that repeats on this weekday every week */
  repeatWeekly?: boolean;
  /** an "open" window offering a single pickable start rather than a grid */
  exactStart?: boolean;
}

/**
 * Colours for the availability layer, one palette per space so several spaces
 * read as distinct at a glance when drawn on the grid together. Hues are handed
 * out by the space's place in your list — blue, then green, then the rest —
 * steering clear of red, because "Unavailable" stays a shared red in every
 * space: "closed" is a universal signal worth keeping recognisable.
 */
type AvailColorSet = { bg: string; border: string; text: string };
type AvailKind = "bookable" | "open" | "weekly" | "block";

const BLOCK_COLOR: AvailColorSet = {
  bg: "oklch(0.94 0.05 25 / 0.5)",
  border: "oklch(0.62 0.14 25)",
  text: "oklch(0.45 0.12 25)",
};

function clinicPalette(hue: number): Record<AvailKind, AvailColorSet> {
  return {
    // Solid and confident — this is the layer that's actually true for clients.
    bookable: { bg: `oklch(0.88 0.09 ${hue} / 0.72)`, border: `oklch(0.52 0.14 ${hue})`, text: `oklch(0.34 0.1 ${hue})` },
    open: { bg: `oklch(0.92 0.06 ${hue} / 0.55)`, border: `oklch(0.6 0.13 ${hue})`, text: `oklch(0.4 0.09 ${hue})` },
    weekly: { bg: `oklch(0.93 0.04 ${hue} / 0.28)`, border: `oklch(0.72 0.07 ${hue})`, text: `oklch(0.46 0.06 ${hue})` },
    block: BLOCK_COLOR,
  };
}

const AVAIL_HUES = [255, 148, 300, 75, 200, 330, 110, 230, 175, 280];

/** A space's availability palette, by its position among all your spaces (archived included, so colours stay put). */
export function availColors(spaces: Space[], id: string): Record<AvailKind, AvailColorSet> {
  const i = spaces.findIndex((s) => s.id === id);
  return clinicPalette(AVAIL_HUES[(i < 0 ? spaces.length : i) % AVAIL_HUES.length]);
}

export interface LaidOutEvent<T> {
  event: T;
  lane: number;
  lanes: number;
}

/**
 * Assign overlapping events to side-by-side lanes (like Google Calendar):
 * events are grouped into transitive-overlap clusters; within a cluster each
 * event takes the lowest free lane and every event's width is 1/lanes of the
 * cluster's lane count.
 */
export function layoutDayEvents<T extends { startMin: number; endMin: number }>(
  events: T[],
): LaidOutEvent<T>[] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: LaidOutEvent<T>[] = [];
  let cluster: LaidOutEvent<T>[] = [];
  let laneEnds: number[] = []; // per-lane latest end within the current cluster
  let clusterEnd = -1;

  const flush = () => {
    for (const item of cluster) item.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const ev of sorted) {
    if (cluster.length && ev.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= ev.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ev.endMin);
    } else {
      laneEnds[lane] = ev.endMin;
    }
    const item: LaidOutEvent<T> = { event: ev, lane, lanes: 1 };
    cluster.push(item);
    out.push(item);
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  flush();
  return out;
}
