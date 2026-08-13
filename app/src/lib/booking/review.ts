// The post-session review email: asks for a Google review and offers a
// one-tap marketing opt-in.
//
// The wording is written once and shared by both clinics — only the review LINK
// differs, because Waterloo and Bethnal Green are separate Google Business
// listings. It used to be a full subject+body per clinic, which meant six boxes
// in Settings to say the same two sentences twice.

import type { Clinic } from "./rules";

export interface ReviewEmailSettings {
  /** the shared wording — what both clinics send */
  reviewEmailSubject?: string;
  reviewEmailBody?: string;
  /** legacy per-clinic wording — the fallback until the shared pair is saved */
  reviewEmailSubjectWaterloo?: string;
  reviewEmailSubjectBethnal?: string;
  reviewEmailBodyWaterloo?: string;
  reviewEmailBodyBethnal?: string;
  /** the one thing that genuinely differs per clinic */
  mapsReviewUrlWaterloo: string;
  mapsReviewUrlBethnal: string;
}

/** The shared subject, or the old per-clinic one until it's saved. */
export function resolveReviewSubject(clinic: Clinic, s: ReviewEmailSettings): string {
  const shared = s.reviewEmailSubject?.trim();
  if (shared) return shared;
  const legacy = (clinic === "waterloo" ? s.reviewEmailSubjectWaterloo : s.reviewEmailSubjectBethnal)?.trim();
  return legacy || "How was your session?";
}

/** The shared body, or the old per-clinic one until it's saved. */
export function resolveReviewBody(clinic: Clinic, s: ReviewEmailSettings): string {
  const shared = s.reviewEmailBody?.trim();
  if (shared) return shared;
  return (clinic === "waterloo" ? s.reviewEmailBodyWaterloo : s.reviewEmailBodyBethnal) ?? "";
}

export function composeReviewEmail(
  clientName: string,
  clinic: Clinic,
  settings: ReviewEmailSettings,
  optInLink: string,
): { subject: string; body: string } {
  const first = clientName?.trim() ? clientName.trim().split(/\s+/)[0] : "there";
  const mapsUrl = clinic === "waterloo" ? settings.mapsReviewUrlWaterloo : settings.mapsReviewUrlBethnal;
  const body = resolveReviewBody(clinic, settings)
    .split("{name}")
    .join(first)
    .split("{mapsUrl}")
    .join(mapsUrl || "(add your Google review link in Settings)")
    .split("{optInLink}")
    .join(optInLink);
  return { subject: resolveReviewSubject(clinic, settings), body };
}
