// Problems found in the *assembled* email — the kind a settings form can't
// show you, because they only exist once several separately-edited fields are
// stitched together. Pure and deterministic: no AI, just pattern matching
// over the blocks composeBookingEmail already produced.
//
// The motivating bug: a Google Maps link pasted into the access note (because
// the "arrival notes" box didn't have one) went out alongside the map link
// composeBookingEmail already adds automatically — so the client saw the same
// link twice, plus the wrong clinic's link. Nothing in the settings form
// showed that; only the composed email did.

import { CLINIC_LABEL, type Clinic } from "./rules";
import {
  PREVIEW_INTAKE_LINK,
  PREVIEW_PORTAL_LINK,
  PREVIEW_PAYMENT_REF,
  clinicDetails,
  resolveSignOff,
  type EmailBlock,
  type EmailSettings,
} from "./email";

export interface EmailIssue {
  severity: "problem" | "suggestion";
  /** short, e.g. "The Bethnal Green map link appears twice" */
  message: string;
  /** what to do about it */
  detail: string;
  blockId?: EmailBlock["id"];
}

export interface CheckEmailOptions {
  /**
   * Set when checking a live browser preview, where the client's real tokens
   * don't exist yet — composeBookingEmail fills the body with PREVIEW_* stand-in
   * strings on purpose (see email.ts), so their presence isn't a sign of a
   * saved template that was never finished, just of not-yet-sent preview.
   */
  allowPreviewStandins?: boolean;
}

const URL_RE = /https?:\/\/[^\s)\]}>"']+/g;
// Trailing punctuation a URL regex tends to swallow when it sits at the end
// of a sentence — "...here: https://maps.app.goo.gl/xyz." shouldn't count the
// period as part of the link.
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/** Every distinct URL found in the text, each with how many times it appears. */
function urlCounts(body: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of body.match(URL_RE) ?? []) {
    const url = match.replace(TRAILING_PUNCT_RE, "");
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  return counts;
}

/**
 * Problems in the email as actually assembled — the account name appearing
 * once, the same map link not appearing twice, no leftover {placeholder}.
 * Pass the `blocks` a real send would use; a hand-edited preview in the
 * booking panel isn't re-checked once Phoenix has typed over it.
 */
export function checkEmail(blocks: EmailBlock[], settings: EmailSettings, options: CheckEmailOptions = {}): EmailIssue[] {
  const issues: EmailIssue[] = [];
  const nonEmpty = blocks.filter((b) => b.text.trim());
  const body = nonEmpty.map((b) => b.text).join("\n\n");
  if (!body) return issues;

  // 1. The same link appearing twice — the bug that started this. Usually
  // means the map link is both pasted into free text (often the access note,
  // which lives inside the "letter" block) and added automatically in the
  // "Where it is" block.
  for (const [url, count] of urlCounts(body)) {
    if (count < 2) continue;
    const inBlocks = nonEmpty.filter((b) => b.text.includes(url)).map((b) => b.label);
    issues.push({
      severity: "problem",
      message: `A link appears ${count} times: ${url}`,
      detail:
        inBlocks.length > 1
          ? `Found in: ${inBlocks.join(", ")}. The map link is already added automatically in "Where it is" — check the other block for a pasted copy.`
          : `It appears ${count} times in the same block. Check for a pasted copy alongside the automatic one.`,
      blockId: nonEmpty.find((b) => b.text.includes(url))?.id,
    });
  }

  // 2. The sign-off appearing twice — composeBookingEmail strips one out of
  // the letter before appending the configured sign-off once, so this should
  // be structurally impossible; flagged anyway as a regression check.
  const signOff = resolveSignOff(settings).trim();
  if (signOff && countOccurrences(body, signOff) > 1) {
    issues.push({
      severity: "problem",
      message: "The sign-off appears more than once",
      detail: "Check the welcome message doesn't already end with its own sign-off — only the one in Settings should go out.",
      blockId: "signoff",
    });
  }

  // 3. A map pin with no address above it, or an address with nothing to
  // find the door — either half missing makes the other read oddly.
  const whereBlock = blocks.find((b) => b.id === "where");
  if (whereBlock) {
    const clinic = whereBlock.source.kind === "location" ? whereBlock.source.clinic : undefined;
    if (clinic) checkClinicLocation(issues, clinic, settings);
  }

  // 4. Bank digits appearing more than once — paymentBlock() already strips a
  // repeated account/sort line from the free-text box, so this too is a
  // regression check for anywhere else those digits might have been typed.
  const digits = (x?: string) => (x ?? "").replace(/\D/g, "");
  for (const [label, raw] of [
    ["account number", settings.bankAccountNumber],
    ["sort code", settings.bankSortCode],
  ] as const) {
    const d = digits(raw);
    if (d.length < 6) continue;
    if (countOccurrences(body, d) > 1) {
      issues.push({
        severity: "problem",
        message: `The bank ${label} appears more than once`,
        detail: "It's meant to appear only in the structured bank details — check the payment wording or letter for a pasted copy.",
        blockId: "bank",
      });
    }
  }

  // 5. A {placeholder} that never got filled in — usually a typo'd token name.
  const placeholders = new Set((body.match(/\{[a-zA-Z]+\}/g) ?? []).map((m) => m));
  for (const p of placeholders) {
    issues.push({
      severity: "problem",
      message: `${p} was never filled in`,
      detail: "Either it's misspelled, or it isn't one of the placeholders this email fills in.",
    });
  }

  // 6. A preview stand-in saved into a real template — the browser preview
  // fills unresolved links with placeholder text before a real booking
  // exists; if that literal text is what's stored, a client would receive it
  // verbatim instead of their link.
  if (!options.allowPreviewStandins) {
    for (const standin of [PREVIEW_INTAKE_LINK, PREVIEW_PORTAL_LINK, PREVIEW_PAYMENT_REF]) {
      if (body.includes(standin)) {
        issues.push({
          severity: "problem",
          message: `The template still contains the placeholder text "${standin}"`,
          detail: "That's a stand-in for the real link, only meant to show up in the live preview — not saved into the message itself.",
        });
      }
    }
  }

  return issues;
}

function checkClinicLocation(issues: EmailIssue[], clinic: Clinic, settings: EmailSettings): void {
  const { address, locationUrl, directions } = clinicDetails(clinic, settings);
  const label = CLINIC_LABEL[clinic];
  if (locationUrl && !address) {
    issues.push({
      severity: "problem",
      message: `${label} has a map link but no address`,
      detail: "The map link ends up with nothing above it — add the address in Settings › Where each clinic is.",
      blockId: "where",
    });
  }
  if (!locationUrl) {
    issues.push({
      severity: "suggestion",
      message: `${label} has no map pin set`,
      detail: "Without one, the email falls back to a generated Google Maps search link rather than the exact spot.",
      blockId: "where",
    });
  }
  if (!directions) {
    issues.push({
      severity: "suggestion",
      message: `${label} has no "how to find it" note set`,
      detail: "Buzzer code, floor, which door — worth adding so the map link isn't the only guidance.",
      blockId: "where",
    });
  }
}
