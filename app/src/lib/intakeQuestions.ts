// The intake form is configurable in Settings. Standard questions map to Client
// columns; custom ones (added by Phoenix) are saved into the client's Doc only.
//
// Most questions also carry a `caseKey` — the box in the case history that the
// answer seeds (see caseHistoryLayout.ts). That's the point of the form: the
// client fills the history in before they arrive, so the session isn't spent
// taking one. The mapping lives on the question rather than being guessed from
// its wording, so re-wording a question here can't silently detach it.

import { isEntryKey } from "@/lib/caseHistoryLayout";

export type IntakeQuestionType = "short" | "long" | "date";

export interface IntakeQuestion {
  key: string;
  label: string;
  type: IntakeQuestionType;
  enabled: boolean;
  /** true = user-added; answer goes to the Doc, not a record column */
  custom?: boolean;
  /** case history box this answer seeds, e.g. "family.mother" */
  caseKey?: string;
  /** a heading shown above this question on the form, starting a new group */
  groupLabel?: string;
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

/**
 * The built-in questions, used when Settings hasn't customised them.
 *
 * Long by design — it covers the whole case history so it doesn't have to be
 * taken in the room. Anything not wanted can be switched off in Settings.
 */
export const DEFAULT_INTAKE_QUESTIONS: IntakeQuestion[] = [
  // — about you —
  { key: "dob", label: "Date of birth", type: "date", enabled: true, groupLabel: "About you" },
  { key: "phone", label: "Phone number", type: "short", enabled: true },
  { key: "occupation", label: "Occupation", type: "short", enabled: true },
  { key: "doctor", label: "GP / doctor (name & surgery)", type: "short", enabled: true },
  { key: "emergency", label: "Emergency contact (name & number)", type: "short", enabled: true },
  { key: "referred", label: "How did you hear about me?", type: "short", enabled: true },

  // — why you're coming —
  {
    key: "reasons",
    label: "What's brought you here — your symptoms, and what you'd like help with",
    type: "long",
    enabled: true,
    caseKey: "reasons",
    groupLabel: "Why you're coming",
  },
  {
    key: "history",
    label: "The story of it — when it began, what's happened since, what makes it better or worse",
    type: "long",
    enabled: true,
    caseKey: "history",
  },

  // — what's happened to you —
  {
    key: "accidentsOld",
    label: "Accidents and injuries — older ones (falls, whiplash, sports injuries, breaks)",
    type: "long",
    enabled: true,
    caseKey: "accidents.old",
    groupLabel: "What's happened to you",
  },
  {
    key: "accidentsNew",
    label: "Accidents and injuries — anything recent",
    type: "long",
    enabled: true,
    caseKey: "accidents.new",
  },
  {
    key: "surgeryOld",
    label: "Surgery, illness, hospital stays, trauma or stress — older",
    type: "long",
    enabled: true,
    caseKey: "surgery.old",
  },
  {
    key: "surgeryNew",
    label: "Surgery, illness, hospital stays, trauma or stress — anything recent",
    type: "long",
    enabled: true,
    caseKey: "surgery.new",
  },
  {
    key: "birth",
    label: "Your own birth — anything you know about how it went",
    type: "long",
    enabled: true,
    caseKey: "birth",
  },
  {
    key: "dentistry",
    label: "Dentistry — extractions, braces, implants, jaw work",
    type: "long",
    enabled: true,
    caseKey: "dentistry",
  },

  // — health day to day —
  {
    key: "meds",
    label: "Medication and supplements you take now",
    type: "long",
    enabled: true,
    caseKey: "drugs.present",
    groupLabel: "Health day to day",
  },
  {
    key: "drugsPast",
    label: "Anything you've taken in the past that feels relevant",
    type: "long",
    enabled: true,
    caseKey: "drugs.past",
  },
  { key: "smoking", label: "Smoking", type: "short", enabled: true, caseKey: "drugs.smoking" },
  { key: "alcohol", label: "Alcohol", type: "short", enabled: true, caseKey: "drugs.alcohol" },
  { key: "diet", label: "How you eat and drink, and anything you avoid", type: "long", enabled: true, caseKey: "diet" },

  // — family —
  {
    key: "familyMother",
    label: "Mother — health and history",
    type: "long",
    enabled: true,
    caseKey: "family.mother",
    groupLabel: "Family",
  },
  { key: "familyFather", label: "Father — health and history", type: "long", enabled: true, caseKey: "family.father" },
  { key: "familyPartner", label: "Partner", type: "long", enabled: true, caseKey: "family.husband" },
  { key: "familyChildren", label: "Children", type: "long", enabled: true, caseKey: "family.children" },
  { key: "familySiblings", label: "Siblings", type: "long", enabled: true, caseKey: "family.siblings" },

  // — anything else —
  {
    key: "additional",
    label: "Anything else you'd like me to know — and where you'd like this work to take you",
    type: "long",
    enabled: true,
    caseKey: "additional",
    groupLabel: "Anything else",
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
    // A caseKey pointing at a box that no longer exists is dropped rather than
    // carried around — the seeding would silently do nothing anyway.
    const caseKey = typeof item.caseKey === "string" && isEntryKey(item.caseKey) ? item.caseKey : undefined;
    out.push({
      key: item.key,
      label: item.label,
      type,
      enabled: item.enabled !== false,
      custom: !!item.custom,
      ...(caseKey ? { caseKey } : {}),
      ...(typeof item.groupLabel === "string" && item.groupLabel ? { groupLabel: item.groupLabel } : {}),
    });
  }
  return out.length ? out : DEFAULT_INTAKE_QUESTIONS;
}
