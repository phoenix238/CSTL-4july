// The post-session review email: asks for a Google review and offers a
// one-tap marketing opt-in. Template + Maps link are editable in Settings.

export interface ReviewEmailSettings {
  reviewEmailSubject: string;
  reviewEmailBody: string;
  mapsReviewUrl: string;
}

export function composeReviewEmail(
  clientName: string,
  settings: ReviewEmailSettings,
  optInLink: string,
): { subject: string; body: string } {
  const first = clientName?.trim() ? clientName.trim().split(/\s+/)[0] : "there";
  const body = settings.reviewEmailBody
    .split("{name}")
    .join(first)
    .split("{mapsUrl}")
    .join(settings.mapsReviewUrl || "(add your Google review link in Settings)")
    .split("{optInLink}")
    .join(optInLink);
  return { subject: settings.reviewEmailSubject || "How was your session?", body };
}
