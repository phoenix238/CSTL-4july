import { describe, it, expect } from "vitest";
import { composeReviewEmail, type ReviewEmailSettings } from "./review";

const OPT_IN = "https://cstl.example/preferences/tok-abc";

const settings: ReviewEmailSettings = {
  reviewEmailSubject: "How was your session?",
  reviewEmailBody: "Hi {name},\n\nA review would mean a lot:\n{mapsUrl}\n\nOpt in here:\n{optInLink}",
  mapsReviewUrlWaterloo: "https://g.page/r/waterloo",
  mapsReviewUrlBethnal: "https://g.page/r/bethnal",
};

describe("composeReviewEmail", () => {
  it("sends the same wording to both clinics, with each one's own review link", () => {
    // The wording is written once; only the link differs, because Waterloo and
    // Bethnal Green are separate Google Business listings.
    const w = composeReviewEmail("Maya Okonkwo", "waterloo", settings, OPT_IN);
    const b = composeReviewEmail("Maya Okonkwo", "bethnal", settings, OPT_IN);
    expect(w.subject).toBe("How was your session?");
    expect(b.subject).toBe("How was your session?");
    expect(w.body).toContain("https://g.page/r/waterloo");
    expect(b.body).toContain("https://g.page/r/bethnal");
    expect(w.body).not.toContain("https://g.page/r/bethnal");
    expect(b.body).not.toContain("https://g.page/r/waterloo");
  });

  it("greets by first name and fills the opt-in link", () => {
    const email = composeReviewEmail("Maya Okonkwo", "waterloo", settings, OPT_IN);
    expect(email.body).toContain("Hi Maya,");
    expect(email.body).not.toContain("Okonkwo");
    expect(email.body).toContain(OPT_IN);
  });

  it("falls back to the old per-clinic wording until the shared pair is saved", () => {
    // Existing wording has to keep working untouched — an empty shared field
    // must not mean an empty review email.
    const legacy: ReviewEmailSettings = {
      reviewEmailSubject: "",
      reviewEmailBody: "",
      reviewEmailSubjectWaterloo: "Waterloo — how was it?",
      reviewEmailBodyWaterloo: "Hi {name}, the old Waterloo wording. {mapsUrl}",
      reviewEmailSubjectBethnal: "Bethnal — how was it?",
      reviewEmailBodyBethnal: "Hi {name}, the old Bethnal wording. {mapsUrl}",
      mapsReviewUrlWaterloo: "https://g.page/r/waterloo",
      mapsReviewUrlBethnal: "https://g.page/r/bethnal",
    };
    const w = composeReviewEmail("Maya", "waterloo", legacy, OPT_IN);
    const b = composeReviewEmail("Maya", "bethnal", legacy, OPT_IN);
    expect(w.subject).toBe("Waterloo — how was it?");
    expect(w.body).toContain("the old Waterloo wording");
    expect(b.subject).toBe("Bethnal — how was it?");
    expect(b.body).toContain("the old Bethnal wording");
  });

  it("says what's missing rather than sending a bare gap when a review link isn't set", () => {
    const email = composeReviewEmail("Maya", "waterloo", { ...settings, mapsReviewUrlWaterloo: "" }, OPT_IN);
    expect(email.body).toContain("(add your Google review link in Settings)");
  });

  it("falls back to a friendly greeting when there's no name", () => {
    const email = composeReviewEmail("  ", "bethnal", settings, OPT_IN);
    expect(email.body).toContain("Hi there,");
  });
});
