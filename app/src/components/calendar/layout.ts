// Pure layout + colour logic for the calendar grids — no React, unit-tested.

import type { Clinic } from "@/lib/booking/rules";

export type SpanSource = "booking" | "room" | "chalkFarm" | "personal";

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
  room: {
    label: "R5 room",
    bg: "oklch(0.95 0.035 85)",
    border: "oklch(0.62 0.1 78)",
    text: "oklch(0.5 0.09 75)",
  },
  chalkFarm: {
    label: "Chalk Farm block",
    bg: "oklch(0.94 0.03 148)",
    border: "oklch(0.62 0.13 148)",
    text: "oklch(0.42 0.08 148)",
  },
  personal: {
    label: "Google Calendar",
    bg: "oklch(0.94 0.01 80)",
    border: "oklch(0.75 0.02 70)",
    text: "oklch(0.45 0.02 60)",
  },
};

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
