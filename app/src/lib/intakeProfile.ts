export const FIRST_SESSION_FIELDS = {
  reason: "Reason for coming and goals",
  health: "Health conditions and injuries",
  meds: "Medications",
  surgery: "Surgery and scars",
  family: "Family history and context",
  dental: "Dentistry and jaw history",
  diet: "Diet and digestion",
  followUp: "Follow-up and next steps",
} as const;

export type IntakeAnswer = { key: string; label: string; answer: string };

export function readIntakeAnswers(value: unknown): IntakeAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is IntakeAnswer =>
    item && typeof item.key === "string" && typeof item.label === "string" &&
    typeof item.answer === "string" && !!item.answer.trim(),
  );
}

/** Recover the main answer from the CRM's older, consistently headed Doc exports. */
export function readLegacyIntakeReason(text: string): IntakeAnswer[] {
  const start = /^4\. What brings them to therapy\s*$/m;
  const end = /^5\. Consent\s*$/m;
  const sections = text.split(/^INTAKE \/ CASE HISTORY — submitted [^\r\n]+$/m).slice(1);
  for (const section of sections.reverse()) {
    const match = start.exec(section);
    if (!match) continue;
    const following = section.slice(match.index + match[0].length);
    const consent = end.exec(following);
    const answer = consent && following.slice(0, consent.index).trim();
    if (answer && answer !== "—") return [{ key: "caseHistory", label: "What brings you to therapy", answer }];
  }
  return [];
}
