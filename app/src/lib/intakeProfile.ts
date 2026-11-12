import type { IntakeQuestion } from "./intakeQuestions";

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

const QUESTION_FIELDS: Record<string, string> = { caseHistory: "reason", conditions: "health" };

export function extendedIntakeFields(questions: IntakeQuestion[], answers: IntakeAnswer[]) {
  const fields = new Map<string, string>(Object.entries(FIRST_SESSION_FIELDS));
  for (const { key, label } of [...questions.filter((question) => question.enabled), ...answers]) {
    const field = QUESTION_FIELDS[key] ?? key;
    if (!fields.has(field)) fields.set(field, label);
  }
  return [...fields].map(([key, label]) => ({
    key, label,
    original: answers.find((answer) => (QUESTION_FIELDS[answer.key] ?? answer.key) === key)?.answer ?? "",
  }));
}

/** Read the archival sections added during the case-history consolidation. */
export function readEarlierCaseHistory(text: string) {
  const sectionHeading = /^Earlier case history — (.+)$/;
  const newRecord = /^(?:Session — |INTAKE \/ CASE HISTORY — |Clean Language session — )/i;
  const sections: { title: string; text: string }[] = [];
  let title = "";
  let lines: string[] = [];

  function finish() {
    const body = lines.join("\n").trim();
    if (title && body) sections.push({ title, text: body });
    title = "";
    lines = [];
  }

  for (const line of text.split(/\r?\n/)) {
    const heading = sectionHeading.exec(line.trim());
    if (heading) {
      finish();
      title = heading[1];
    } else if (newRecord.test(line.trim())) {
      finish();
    } else if (title && line.trim() !== "Open original case document") {
      lines.push(line);
    }
  }
  finish();
  return sections;
}
