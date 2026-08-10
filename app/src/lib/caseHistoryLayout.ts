/**
 * Phoenix's case history sheet, as the app holds it.
 *
 * These are the headers off the paper form, in her order — the point of the
 * intake form is that a client fills most of this in before they arrive, so the
 * session isn't spent taking a history.
 *
 *   1.  INTAKE FORM                 the form as they submitted it, verbatim
 *   2.  REASONS FOR COMING / SYMPTOMS
 *   3.  HISTORY
 *   4.  ACCIDENTS AND INJURIES                        old / new
 *   5.  SURGERY / ILLNESS / HOSPITAL / TRAUMA / STRESS  old / new
 *   6.  FAMILY                      mother, father, husband, wife, children, siblings
 *   7.  DRUGS                       present, past, smoking, alcohol
 *   8.  DIET
 *   9.  BIRTH
 *   10. DENTISTRY
 *   11. BODY LANGUAGE
 *   12. ADDITIONAL INFORMATION
 *   13. SESSION LOG                 newest first
 *   14. CONSENT & DATA
 *
 * No I/O and no database — the shape of the record only, so it can be unit
 * tested and read in one sitting. caseHistory.ts does the loading and writing.
 */

/** A named box inside a section — the old/new split, the family members. */
export interface CaseHistoryField {
  key: string;
  label: string;
}

export interface CaseHistorySectionSpec {
  key: string;
  heading: string;
  /** The quieter half of a heading, e.g. "where are we and where would you like to go". */
  note?: string;
  /** Shown in the Doc while the section is still empty. */
  hint: string;
  /** Absent = one open box. Present = these boxes, in this order. */
  fields?: CaseHistoryField[];
}

const OLD_NEW: CaseHistoryField[] = [
  { key: "old", label: "Old" },
  { key: "new", label: "New" },
];

/** Sections 2–12 — the case history proper. */
export const CASE_HISTORY_SECTIONS: CaseHistorySectionSpec[] = [
  {
    key: "reasons",
    heading: "REASONS FOR COMING / SYMPTOMS",
    hint: "What they've come with, in their own words where possible.",
  },
  {
    key: "history",
    heading: "HISTORY",
    hint: "The story of it — when it began, what's happened since, what helps and what aggravates.",
  },
  {
    key: "accidents",
    heading: "ACCIDENTS AND INJURIES",
    hint: "Falls, whiplash, sports injuries, breaks — with rough dates.",
    fields: OLD_NEW,
  },
  {
    key: "surgery",
    heading: "SURGERY / ILLNESS / HOSPITAL / TRAUMA / STRESS",
    hint: "Operations, serious illness, hospital stays, and periods of trauma or stress.",
    fields: OLD_NEW,
  },
  {
    key: "family",
    heading: "FAMILY",
    hint: "Health and history through the family, and who's around them now.",
    fields: [
      { key: "mother", label: "Mother" },
      { key: "father", label: "Father" },
      { key: "husband", label: "Husband" },
      { key: "wife", label: "Wife" },
      { key: "children", label: "Children" },
      { key: "siblings", label: "Siblings" },
    ],
  },
  {
    key: "drugs",
    heading: "DRUGS",
    hint: "Medication and supplements now and previously, plus smoking and alcohol.",
    fields: [
      { key: "present", label: "Present" },
      { key: "past", label: "Past" },
      { key: "smoking", label: "Smoking" },
      { key: "alcohol", label: "Alcohol" },
    ],
  },
  { key: "diet", heading: "DIET", hint: "How they eat and drink, and anything they avoid." },
  {
    key: "birth",
    heading: "BIRTH",
    hint: "Their own birth — how it went, interventions, anything known about it.",
  },
  {
    key: "dentistry",
    heading: "DENTISTRY",
    hint: "Extractions, braces, implants, jaw work — anything done to the mouth.",
  },
  {
    key: "bodyLanguage",
    heading: "BODY LANGUAGE",
    hint: "What you observe — how they hold themselves, sit, breathe, move.",
  },
  {
    key: "additional",
    heading: "ADDITIONAL INFORMATION",
    note: "where are we and where would you like to go",
    hint: "Anything else, and what they're hoping this work moves towards.",
  },
];

/** Numbering: 1 is the intake form, 2–12 the history, then the log and consent. */
const FIRST_SECTION_NUMBER = 2;
export const SESSION_LOG_NUMBER = FIRST_SECTION_NUMBER + CASE_HISTORY_SECTIONS.length; // 13
export const CONSENT_NUMBER = SESSION_LOG_NUMBER + 1; // 14

export const CASE_HISTORY_TITLE_PREFIX = "CASE HISTORY — ";
export const INTAKE_HEADING = "1. INTAKE FORM";
export const SESSION_LOG_HEADING = `${SESSION_LOG_NUMBER}. SESSION LOG`;
export const CONSENT_HEADING = `${CONSENT_NUMBER}. CONSENT & DATA`;

/**
 * Marks the untouched copy of a Doc's contents from before it was reformatted,
 * and how a re-run recognises the tail it must carry through rather than fold
 * into itself again.
 */
export const ORIGINAL_RECORD_HEADING = "ORIGINAL RECORD — BEFORE REFORMATTING";

export const ORIGINAL_RECORD_HINT =
  "Everything this Doc held before it was reformatted, kept word for word. Nothing above replaces it — delete this section once you're happy the record above is complete.";

/** "4. ACCIDENTS AND INJURIES" — the heading as it appears in the Doc. */
export function sectionHeading(key: string): string {
  const index = CASE_HISTORY_SECTIONS.findIndex((s) => s.key === key);
  if (index === -1) return key;
  const section = CASE_HISTORY_SECTIONS[index];
  const number = FIRST_SECTION_NUMBER + index;
  return section.note
    ? `${number}. ${section.heading} — ${section.note}`
    : `${number}. ${section.heading}`;
}

/**
 * How one box is addressed: "diet" for an open section, "family.mother" for a
 * box inside one. Flat keys keep the stored record a plain string map, which is
 * far easier to validate coming back out of a Json column.
 */
export function entryKey(sectionKey: string, fieldKey?: string): string {
  return fieldKey ? `${sectionKey}.${fieldKey}` : sectionKey;
}

/** Every box in the case history, in the order it's written and edited. */
export function allEntryKeys(): string[] {
  return CASE_HISTORY_SECTIONS.flatMap((section) =>
    section.fields
      ? section.fields.map((field) => entryKey(section.key, field.key))
      : [entryKey(section.key)],
  );
}

const VALID_KEYS = new Set(allEntryKeys());

export const isEntryKey = (key: string): boolean => VALID_KEYS.has(key);

/** The label to show against a box — the field's name, or the section's. */
export function entryLabel(key: string): string {
  const [sectionKey, fieldKey] = key.split(".");
  const section = CASE_HISTORY_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return key;
  if (!fieldKey) return section.heading;
  return section.fields?.find((f) => f.key === fieldKey)?.label ?? fieldKey;
}
