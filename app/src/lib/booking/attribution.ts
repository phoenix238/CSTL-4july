/**
 * Which campaign an online booking came from.
 *
 * The website passes the utm_ tags from its own address into this page's
 * address (see contact.html); the booking form sends them along, and they're
 * saved on the booking row. They are campaign labels, not personal details,
 * and they stay in this database: nothing here is sent to Meta or Google.
 *
 * Whatever arrives is untrusted, so each value is reduced to a short string of
 * plain characters. Anything that doesn't fit is dropped rather than rejected,
 * because a bad tag must never stop someone booking.
 */
export interface Attribution {
  adSource: string;
  adMedium: string;
  adCampaign: string;
  adContent: string;
}

const MAX_LEN = 80;

function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.\- ]/g, "")
    .slice(0, MAX_LEN);
}

/** Server side: shape-check the `attribution` object from the request body. */
export function cleanAttribution(raw: unknown): Attribution | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const a: Attribution = {
    adSource: clean(r.utm_source),
    adMedium: clean(r.utm_medium),
    adCampaign: clean(r.utm_campaign),
    adContent: clean(r.utm_content),
  };
  return a.adSource || a.adMedium || a.adCampaign || a.adContent ? a : undefined;
}

/** Browser side: read the utm_ tags from the page's own address. */
export function readAttributionFromLocation(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const p = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const v = p.get(k);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
