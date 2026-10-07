// The places a practitioner works from — "spaces".
//
// Every booking happens at one space. A space carries everything that used to
// be hard-wired per clinic: its name, price, address and how to find the door,
// its review link, its colour on the calendar, the gap kept between sessions,
// and how (if at all) it books a shared venue calendar:
//
//   none     — nothing beyond the practitioner's own session event
//   room     — one event per session on the venue's room calendar
//              (Phoenix's Waterloo: "R5 - Phoenix" on the R5 calendar)
//   dayBlock — one shared block per cluster of sessions on the venue's
//              calendar, auto-sized to span them (Phoenix's Bethnal Green on
//              the Chalk Farm calendar — see google/chalkFarm.ts)
//
// Spaces are stored as a list on AppSettings.spaces. An install that has never
// saved that list — Phoenix's, today — reads its two clinics out of the old
// per-clinic columns instead (legacySpaces below), so nothing changes for it
// until the list is first saved from Settings. A space's `id` is what bookings,
// clients and availability rows store, so it never changes once chosen; the
// two legacy ids stay "waterloo" and "bethnal" so existing rows keep matching.
//
// Pure — runs on the server and, passed in as props or context, in the browser.

export type VenueMode = "none" | "room" | "dayBlock";
export type PriceKind = "fixed" | "sliding";

export interface Space {
  /** stable id stored on bookings, clients and availability — never renamed */
  id: string;
  /** what everyone sees: "Waterloo", "The Garden Room" */
  name: string;
  /** optional name on the booking pages' chooser ("Low cost Bethnal Green"); "" = name */
  bookingLabel: string;
  /** archived spaces stay readable for past sessions but can't be booked */
  active: boolean;

  priceKind: PriceKind;
  /** fixed price, in pence */
  pricePence: number;
  /** sliding scale bounds, in pence */
  priceMinPence: number;
  priceMaxPence: number;
  /** optional wording that replaces the generated price ("£80, card or transfer"); "" = generated */
  priceLabel: string;

  /** full street address — the calendar invite location and the map link */
  address: string;
  /** a map pin link — preferred over a generated search link */
  mapUrl: string;
  /** buzzer, floor, which door */
  findIt: string;
  /** photo of the entrance, as a data: URL */
  photo: string;
  /** "leave a Google review" link for this space's listing */
  reviewUrl: string;
  /** neighbourhoods it suits — helps the enquiry reader suggest the right space */
  nearby: string;

  /** Google Calendar event colour id, "1"–"11" (see EVENT_COLORS) */
  eventColor: string;
  /** minimum gap between two of your own sessions here, in minutes */
  bufferMinutes: number;
  /** most hours of your sessions bookable here per Mon–Sun week; 0 = no limit */
  weeklyCapHours: number;

  venueMode: VenueMode;
  /** the venue's shared Google Calendar id (room / dayBlock modes) */
  venueCalendarId: string;
  /** the title put on the venue calendar ("R5 - Phoenix") — never a client's name */
  venueEventTitle: string;
  /** dayBlock: safety gap around other people's bookings on the venue calendar */
  venueBufferMinutes: number;
  /** dayBlock: padding before the first and after the last session of a block */
  venueEdgeMinutes: number;
  /** dayBlock: sessions this close together share one block */
  venueClusterGapMinutes: number;
}

/** Google Calendar's eleven event colours, by id — with a soft chip tint for the app. */
export const EVENT_COLORS: Record<string, { name: string; hex: string }> = {
  "1": { name: "Lavender", hex: "#7986cb" },
  "2": { name: "Sage", hex: "#33b679" },
  "3": { name: "Grape", hex: "#8e24aa" },
  "4": { name: "Flamingo", hex: "#e67c73" },
  "5": { name: "Banana", hex: "#f6bf26" },
  "6": { name: "Tangerine", hex: "#f4511e" },
  "7": { name: "Peacock", hex: "#039be5" },
  "8": { name: "Graphite", hex: "#616161" },
  "9": { name: "Blueberry", hex: "#3f51b5" },
  "10": { name: "Basil", hex: "#0b8043" },
  "11": { name: "Tomato", hex: "#d50000" },
};

/** A new, empty space — what "Add a space" starts from. */
export function blankSpace(id: string, name = ""): Space {
  return {
    id,
    name,
    bookingLabel: "",
    active: true,
    priceKind: "fixed",
    pricePence: 0,
    priceMinPence: 0,
    priceMaxPence: 0,
    priceLabel: "",
    address: "",
    mapUrl: "",
    findIt: "",
    photo: "",
    reviewUrl: "",
    nearby: "",
    eventColor: "7",
    bufferMinutes: 15,
    weeklyCapHours: 0,
    venueMode: "none",
    venueCalendarId: "",
    venueEventTitle: "",
    venueBufferMinutes: 30,
    venueEdgeMinutes: 15,
    venueClusterGapMinutes: 45,
  };
}

/** A url-safe id from a name, unique among `taken`: "The Garden Room" → "the-garden-room". */
export function spaceIdFrom(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "space";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The old per-clinic columns — what an install that has never saved its spaces still runs on. */
export interface LegacySpaceSettings {
  waterlooAddress?: string;
  bethnalAddress?: string;
  waterlooLocationUrl?: string;
  bethnalLocationUrl?: string;
  waterlooFindIt?: string;
  bethnalFindIt?: string;
  waterlooDirections?: string;
  bethnalDirections?: string;
  waterlooArrivalNote?: string;
  bethnalArrivalNote?: string;
  waterlooPhoto?: string;
  bethnalPhoto?: string;
  mapsReviewUrlWaterloo?: string;
  mapsReviewUrlBethnal?: string;
  roomCalendarId?: string;
  chalkFarmCalendarId?: string;
  bookingBufferMinutes?: number;
  bethnalBufferMinutes?: number;
  chalkFarmBufferMinutes?: number;
  chalkFarmEdgeBufferMinutes?: number;
  chalkFarmClusterGapMinutes?: number;
  chalkFarmWeeklyCapHours?: number;
  practitionerName?: string;
}

/** The old merged find-it field, falling back to the older directions/arrival pair. */
function legacyFindIt(current?: string, directions?: string, arrival?: string): string {
  if (current?.trim()) return current.trim();
  return [directions?.trim(), arrival?.trim()].filter(Boolean).join("\n");
}

/**
 * Phoenix's two clinics, exactly as the hard-wired code described them, built
 * from the columns his Settings already fill. This is what keeps an existing
 * install behaving identically until its spaces are first saved.
 */
export function legacySpaces(s: LegacySpaceSettings): Space[] {
  const me = s.practitionerName?.trim() || "Phoenix";
  // Bethnal Green first, as every picker and the booking page always opened on it.
  return [
    {
      ...blankSpace("bethnal", "Bethnal Green"),
      bookingLabel: "Low cost Bethnal Green",
      priceKind: "sliding",
      priceMinPence: 3000,
      priceMaxPence: 6000,
      address: s.bethnalAddress ?? "",
      mapUrl: s.bethnalLocationUrl ?? "",
      findIt: legacyFindIt(s.bethnalFindIt, s.bethnalDirections, s.bethnalArrivalNote),
      photo: s.bethnalPhoto ?? "",
      reviewUrl: s.mapsReviewUrlBethnal ?? "",
      nearby: 'east: Bethnal Green, Victoria Park, Hackney, Mile End, "out east"',
      eventColor: "4", // Flamingo
      bufferMinutes: s.bethnalBufferMinutes ?? 15,
      weeklyCapHours: s.chalkFarmWeeklyCapHours ?? 10,
      venueMode: "dayBlock",
      venueCalendarId: s.chalkFarmCalendarId ?? "",
      venueEventTitle: me,
      venueBufferMinutes: s.chalkFarmBufferMinutes ?? 30,
      venueEdgeMinutes: s.chalkFarmEdgeBufferMinutes ?? 15,
      venueClusterGapMinutes: s.chalkFarmClusterGapMinutes ?? 45,
    },
    {
      ...blankSpace("waterloo", "Waterloo"),
      pricePence: 8000,
      address: s.waterlooAddress ?? "",
      mapUrl: s.waterlooLocationUrl ?? "",
      findIt: legacyFindIt(s.waterlooFindIt, s.waterlooDirections, s.waterlooArrivalNote),
      photo: s.waterlooPhoto ?? "",
      reviewUrl: s.mapsReviewUrlWaterloo ?? "",
      nearby: "south/central: Waterloo, South Bank, Southwark, Kennington, Lambeth",
      eventColor: "6", // Tangerine
      bufferMinutes: s.bookingBufferMinutes ?? 0,
      venueMode: "room",
      venueCalendarId: s.roomCalendarId ?? "",
      venueEventTitle: `R5 - ${me}`,
    },
  ];
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** One stored space, with every field present and of the right type. */
function cleanSpace(raw: Record<string, unknown>): Space | null {
  const id = str(raw.id).trim();
  if (!id) return null;
  const d = blankSpace(id);
  const mode = str(raw.venueMode);
  return {
    id,
    name: str(raw.name).trim() || id,
    bookingLabel: str(raw.bookingLabel),
    active: raw.active !== false,
    priceKind: raw.priceKind === "sliding" ? "sliding" : "fixed",
    pricePence: num(raw.pricePence),
    priceMinPence: num(raw.priceMinPence),
    priceMaxPence: num(raw.priceMaxPence),
    priceLabel: str(raw.priceLabel),
    address: str(raw.address),
    mapUrl: str(raw.mapUrl),
    findIt: str(raw.findIt),
    photo: str(raw.photo),
    reviewUrl: str(raw.reviewUrl),
    nearby: str(raw.nearby),
    eventColor: EVENT_COLORS[str(raw.eventColor)] ? str(raw.eventColor) : d.eventColor,
    bufferMinutes: num(raw.bufferMinutes, d.bufferMinutes),
    weeklyCapHours: num(raw.weeklyCapHours),
    venueMode: mode === "room" || mode === "dayBlock" ? mode : "none",
    venueCalendarId: str(raw.venueCalendarId).trim(),
    venueEventTitle: str(raw.venueEventTitle),
    venueBufferMinutes: num(raw.venueBufferMinutes, d.venueBufferMinutes),
    venueEdgeMinutes: num(raw.venueEdgeMinutes, d.venueEdgeMinutes),
    venueClusterGapMinutes: num(raw.venueClusterGapMinutes, d.venueClusterGapMinutes),
  };
}

/**
 * Every space, in the practitioner's order — the saved list, or Phoenix's two
 * clinics from the old columns if the list has never been saved.
 */
export function resolveSpaces(s: { spaces?: unknown } & LegacySpaceSettings): Space[] {
  if (Array.isArray(s.spaces) && s.spaces.length) {
    const seen = new Set<string>();
    const out: Space[] = [];
    for (const raw of s.spaces) {
      if (!raw || typeof raw !== "object") continue;
      const sp = cleanSpace(raw as Record<string, unknown>);
      if (sp && !seen.has(sp.id)) {
        seen.add(sp.id);
        out.push(sp);
      }
    }
    if (out.length) return out;
  }
  return legacySpaces(s);
}

/** The spaces clients can book. */
export function activeSpaces(spaces: Space[]): Space[] {
  return spaces.filter((s) => s.active);
}

/**
 * One space by id. An id that's no longer in the list (a space deleted outright
 * rather than archived) still resolves — to a bare stand-in named after the id —
 * so a past booking there can always be shown rather than crashing the page.
 */
export function spaceById(spaces: Space[], id: string | null | undefined): Space {
  return spaces.find((s) => s.id === id) ?? { ...blankSpace(id || "unknown", id || "Unknown space"), active: false };
}

/** The space's name, for anywhere a label is needed. */
export function spaceName(spaces: Space[], id: string | null | undefined): string {
  return spaceById(spaces, id).name;
}

/** The name on the booking pages' chooser. */
export function spaceBookingLabel(space: Space): string {
  return space.bookingLabel.trim() || space.name;
}

/** Whole pounds without ".00", otherwise two decimals: 8000 → "£80", 4550 → "£45.50". */
export function poundsLabel(pence: number): string {
  const p = pence / 100;
  return `£${Number.isInteger(p) ? p : p.toFixed(2)}`;
}

/** "£80", "£30–60 sliding scale", or the practitioner's own wording. */
export function spacePriceLabel(space: Space): string {
  if (space.priceLabel.trim()) return space.priceLabel.trim();
  if (space.priceKind === "sliding") {
    const lo = poundsLabel(space.priceMinPence);
    const hi = poundsLabel(space.priceMaxPence).slice(1);
    return `${lo}–${hi} sliding scale`;
  }
  return space.pricePence ? poundsLabel(space.pricePence) : "";
}

/**
 * What a session here costs by default, in pence — a fixed price is known up
 * front; a sliding scale stays null until the actual amount is recorded.
 */
export function spaceDefaultAmountPence(space: Space): number | null {
  return space.priceKind === "fixed" && space.pricePence > 0 ? space.pricePence : null;
}

/** The space whose venue uses a shared day block, if any — at most one is supported. */
export function dayBlockSpace(spaces: Space[]): Space | undefined {
  return spaces.find((s) => s.venueMode === "dayBlock" && s.venueCalendarId);
}

/** Problems that would stop the list being saved, in plain words. Empty = fine. */
export function validateSpaces(spaces: Space[]): string[] {
  const errors: string[] = [];
  if (!spaces.some((s) => s.active)) errors.push("Keep at least one space open for booking.");
  const ids = new Set<string>();
  for (const s of spaces) {
    if (!s.name.trim()) errors.push("Every space needs a name.");
    if (ids.has(s.id)) errors.push(`Two spaces share the id "${s.id}".`);
    ids.add(s.id);
    if (s.priceKind === "sliding" && s.priceMaxPence < s.priceMinPence) {
      errors.push(`${s.name || "A space"}: the top of the sliding scale is below the bottom.`);
    }
  }
  if (spaces.filter((s) => s.venueMode === "dayBlock").length > 1) {
    errors.push("Only one space can use a shared day block on a venue calendar.");
  }
  return [...new Set(errors)];
}

/** The spaces as sent to the browser on every screen — without the (large) entrance photos. */
export function spacesForClient(spaces: Space[]): Space[] {
  return spaces.map((s) => ({ ...s, photo: "" }));
}
