import { fmtDayLong, fmtTime } from "@/lib/time";
import { CLINIC_LABEL, type Clinic } from "./rules";
import { CLIENT_COPY_DEFAULTS, applyCopy, type ClientCopy } from "@/lib/clientCopy";

type OfferCopy = Pick<ClientCopy, "offerEmailBody" | "offerPickLinkLine">;

/**
 * The message offering a client a few times to choose from. Pure — used both
 * for the email (server) and the WhatsApp text (client) so they read the same.
 * `pickUrl`, when given, adds a line so the client can self-book instantly
 * instead of replying to say which time suits. `copy` overrides the wording
 * (from Settings); it falls back to the built-in defaults.
 */
export function composeOfferMessage(
  clientName: string,
  clinic: Clinic,
  times: Date[],
  pickUrl?: string,
  copy: OfferCopy = CLIENT_COPY_DEFAULTS,
): string {
  const first = clientName?.trim() ? clientName.trim().split(/\s+/)[0] : "there";
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  const timesBlock = sorted.map((t) => `  • ${fmtDayLong(t)} at ${fmtTime(t)}`).join("\n");
  const pickLink = pickUrl ? applyCopy(copy.offerPickLinkLine, { link: pickUrl }) : "";
  return applyCopy(copy.offerEmailBody, {
    name: first,
    clinic: CLINIC_LABEL[clinic],
    times: timesBlock,
    pickLink,
  });
}

/**
 * Just the offered times as bare lines — no greeting, sign-off or clinic blurb.
 * One "<day> at <time>" per line, earliest first, for pasting the raw times alone.
 */
export function composeOfferTimesOnly(times: Date[]): string {
  return [...times]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((t) => `${fmtDayLong(t)} at ${fmtTime(t)}`)
    .join("\n");
}
