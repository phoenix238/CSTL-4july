import { describe, expect, it } from "vitest";
import { readIntakeAnswers, readLegacyIntakeReason } from "./intakeProfile";

describe("profile intake", () => {
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
