import { describe, expect, it } from "vitest";
import { extendedIntakeFields, readEarlierCaseHistory, readIntakeAnswers, readLegacyIntakeReason } from "./intakeProfile";

describe("profile intake", () => {
  it("folds submitted answers into existing practitioner fields and keeps older custom answers", () => {
    const fields = extendedIntakeFields([
      { key: "caseHistory", label: "What brings you here?", type: "long", enabled: true },
      { key: "conditions", label: "Health", type: "long", enabled: true },
      { key: "olderQuestion", label: "Old question", type: "long", enabled: false },
    ], [
      { key: "caseHistory", label: "What brings you here?", answer: "My reason" },
      { key: "conditions", label: "Health", answer: "Health history" },
      { key: "olderQuestion", label: "Previously answered", answer: "Still important" },
    ]);
    expect(fields.filter(({ original }) => original).map(({ key, original }) => [key, original])).toEqual([
      ["reason", "My reason"], ["health", "Health history"], ["olderQuestion", "Still important"],
    ]);
    expect(fields.some(({ key }) => key === "caseHistory" || key === "conditions")).toBe(false);
  });

  it("preserves original line breaks and wording in a submitted response", () => {
    expect(readIntakeAnswers([
      { key: "caseHistory", label: "What brings you here?", answer: "  First paragraph.\n\nSecond paragraph.  " },
      { key: "meds", label: "Medications", answer: " " },
    ])).toEqual([
      { key: "caseHistory", label: "What brings you here?", answer: "  First paragraph.\n\nSecond paragraph.  " },
    ]);
  });

  it("recovers the most recent non-empty reason without pulling in other case notes", () => {
    const heading = "4. What brings them to therapy";
    const title = "INTAKE / CASE HISTORY — submitted";
    const text = [
      `${title} 1 Nov 2026`, heading, "Original reason.", "5. Consent",
      `${title} 2 Nov 2026`, heading, "Latest reason.\n\nAnother paragraph.", "5. Consent",
      "Session — 3 Nov 2026", "Therapist note.",
      `${title} 4 Nov 2026`, heading, "—", "5. Consent",
    ].join("\n\n");
    expect(readLegacyIntakeReason(text)[0]?.answer).toBe("Latest reason.\n\nAnother paragraph.");
  });

  it("requires the intake heading and a closing section", () => {
    expect(readLegacyIntakeReason("4. What brings them to therapy\nSession material\n5. Consent")).toEqual([]);
    expect(readLegacyIntakeReason("INTAKE / CASE HISTORY — submitted 2 Nov 2026\n4. What brings them to therapy\nMissing closing heading")).toEqual([]);
  });
});

describe("earlier case history", () => {
  it("shows archived sections without repeating live notes or the source link label", () => {
    const text = [
      "Current client record",
      "Earlier case history — Old intake",
      "Open original case document",
      "",
      "First paragraph.",
      "",
      "Second paragraph.",
      "Earlier case history — Prior visit",
      "Open original case document",
      "Another note.",
      "Session — 11 Nov 2026",
      "Current CRM session.",
    ].join("\n");
    expect(readEarlierCaseHistory(text)).toEqual([
      { title: "Old intake", text: "First paragraph.\n\nSecond paragraph." },
      { title: "Prior visit", text: "Another note." },
    ]);
  });
});
