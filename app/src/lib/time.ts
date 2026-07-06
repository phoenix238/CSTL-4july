// All of Phoenix's scheduling is London wall-clock time; the server (Vercel)
// runs in UTC, so these helpers convert deliberately.

const TZ = "Europe/London";

/** Minutes that London is ahead of UTC at a given instant (0 or 60). */
function londonOffsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1].startsWith("-") ? -1 : 1;
  return sign * (Math.abs(parseInt(m[1], 10)) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
}

/** The Y/M/D of an instant as seen in London. */
export function londonYMD(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

/** UTC instant for a given London wall-clock time (handles DST). */
export function londonTime(y: number, m: number, d: number, hour: number, minute = 0): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  guess = new Date(guess.getTime() - londonOffsetMinutes(guess) * 60_000);
  // Second pass in case the first guess straddled a DST switch.
  const wall = new Date(guess.getTime() + londonOffsetMinutes(guess) * 60_000);
  if (wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute) {
    guess = new Date(Date.UTC(y, m - 1, d, hour, minute) - londonOffsetMinutes(guess) * 60_000);
  }
  return guess;
}

/** Start of a London day `offsetDays` from today. */
export function londonDayStart(offsetDays = 0, from = new Date()): Date {
  const shifted = new Date(from.getTime() + offsetDays * 86_400_000);
  const { y, m, d } = londonYMD(shifted);
  return londonTime(y, m, d, 0, 0);
}

export const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export const fmtDayShort = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric" }).format(d); // "Thu 2"

export const fmtDayLong = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d); // "Thursday 2 July"

export const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(d); // "2 Jul 2026"

/** Start of the London week (Monday 00:00) containing `from`. */
export function londonWeekStart(from = new Date()): Date {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(from);
  const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  return londonDayStart(-(idx < 0 ? 0 : idx), from);
}

/** Minutes past London midnight for an instant. */
export function londonMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  const [h, m] = parts.split(":").map(Number);
  return (h === 24 ? 0 : h) * 60 + m;
}
