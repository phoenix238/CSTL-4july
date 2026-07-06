// The intake form is configurable in Settings. Standard questions map to Client
// columns; custom ones (added by Phoenix) are saved into the client's Doc only.

export type IntakeQuestionType = "short" | "long" | "date";

export interface IntakeQuestion {
  key: string;
  label: string;
  type: IntakeQuestionType;
  enabled: boolean;
  /** true = user-added; answer goes to the Doc, not a record column */
  custom?: boolean;
}

/** Standard keys that map onto Client columns (marketing is intentionally not here). */
export const COLUMN_KEYS = new Set(["dob", "phone", "occupation", "doctor", "conditions", "meds", "emergency", "referred"]);

/**
 * Fixed consent wording, shown on every intake form and logged verbatim to
 * the client's Doc alongside their answer — not part of the configurable
 * question list, since it shouldn't be casually reworded or removed.
 */
export const CONSENT_PARAGRAPHS = [
  "I consent to receiving craniosacral therapy and understand I can stop the session at any time.",
  "I understand that this is not a substitute for medical treatment or diagnosis.",
  "I give permission for Phoenix to take and securely store my information in line with data protection laws. My information will not be shared with anyone else and will only be used for therapeutic and record-keeping purposes.",
  "I understand I can request to access or delete my data at any time by contacting Phoenix.",
];

/** The built-in questions, used when Settings hasn't customised them. */
export const DEFAULT_INTAKE_QUESTIONS: IntakeQuestion[] = [
  { key: "dob", label: "Date of birth", type: "date", enabled: true },
  { key: "phone", label: "Phone number", type: "short", enabled: true },
  { key: "occupation", label: "Occupation", type: "short", enabled: true },
  { key: "doctor", label: "GP / doctor (name & surgery)", type: "short", enabled: true },
  { key: "meds", label: "Any medications you take", type: "long", enabled: true },
  { key: "conditions", label: "Health conditions / injuries I should know about", type: "long", enabled: true },
  { key: "emergency", label: "Emergency contact (name & number)", type: "short", enabled: true },
  { key: "referred", label: "How did you hear about me?", type: "short", enabled: true },
  {
    key: "caseHistory",
    label: "What brings you to therapy — anything you'd like me to know",
    type: "long",
    enabled: true,
  },
];

/** Validate/normalise whatever is stored in AppSettings.intakeQuestions. */
export function resolveIntakeQuestions(raw: unknown): IntakeQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_INTAKE_QUESTIONS;
  const out: IntakeQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const item = q as Record<string, unknown>;
    if (typeof item.key !== "string" || typeof item.label !== "string") continue;
    const type: IntakeQuestionType =
      item.type === "long" || item.type === "date" ? item.type : "short";
    out.push({
      key: item.key,
      label: item.label,
      type,
      enabled: item.enabled !== false,
      custom: !!item.custom,
    });
  }
  return out.length ? out : DEFAULT_INTAKE_QUESTIONS;
}
