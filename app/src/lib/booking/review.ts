// The post-session review email: asks for a Google review and offers a
// one-tap marketing opt-in. Each clinic has its own template + Maps review
// link (different Google Business listing), both editable in Settings.

import type { Clinic } from "./rules";

export interface ReviewEmailSettings {
  reviewEmailSubjectWaterloo: string;
  reviewEmailSubjectBethnal: string;
  reviewEmailBodyWaterloo: string;
  reviewEmailBodyBethnal: string;
  mapsReviewUrlWaterloo: string;
  mapsReviewUrlBethnal: string;
}

export function composeReviewEmail(
  clientName: string,
  clinic: Clinic,
  settings: ReviewEmailSettings,
  optInLink: string,
): { subject: string; body: string } {
  const first = clientName?.trim() ? clientName.trim().split(/\s+/)[0] : "there";
  const subject = clinic === "waterloo" ? settings.reviewEmailSubjectWaterloo : settings.reviewEmailSubjectBethnal;
  const template = clinic === "waterloo" ? settings.reviewEmailBodyWaterloo : settings.reviewEmailBodyBethnal;
  const mapsUrl = clinic === "waterloo" ? settings.mapsReviewUrlWaterloo : settings.mapsReviewUrlBethnal;
  const body = template
    .split("{name}")
    .join(first)
    .split("{mapsUrl}")
    .join(mapsUrl || "(add your Google review link in Settings)")
    .split("{optInLink}")
    .join(optInLink);
  return { subject: subject || "How was your session?", body };
}
