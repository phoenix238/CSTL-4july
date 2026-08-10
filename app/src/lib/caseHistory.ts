/**
 * The standard CSTL case history layout.
 *
 * Every client's Google Doc is a *rendering* of this: a fixed set of numbered
 * headers, in the same order, for every client — so any Doc can be read at a
 * glance and nothing has to be hunted for.
 *
 *   CASE HISTORY — <name>
 *   AT A GLANCE
 *   1.  INTAKE FORM              ← the form as they submitted it, verbatim, at the top
 *   2.  PRESENTING ISSUE         ← seeded from intake
 *   …
 *   13. SESSION LOG              ← notes append in here, newest first
 *   14. CONSENT & DATA
 *   ORIGINAL RECORD              ← only on reformatted Docs: the old text, kept whole
 *
 * The narrative sections (2–12) live on `Client.caseHistory` and the Doc is
 * written from them, which is what lets an old free-text Doc be rebuilt into
 * this shape — and rebuilt again later — without re-reading it every time.
 */

import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import {
  rebuildDoc,
  insertSectionsUnderHeading,
  replaceSectionUnderHeading,
  appendFormattedSections,
  getDocPlainText,
  type DocLine,
  type DocSection,
} from "@/lib/google/drive";
import { CONSENT_PARAGRAPHS } from "@/lib/intakeQuestions";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/* ---------- the layout ---------- */

/** Sections 2–12: the clinical narrative, one free-text block each. */
export const NARRATIVE_SECTIONS = [
  {
    key: "presenting",
    heading: "PRESENTING ISSUE",
    hint: "What they've come with, in their own words where possible.",
  },
  {
    key: "historyOfPresenting",
    heading: "HISTORY OF PRESENTING ISSUE",
    hint: "When it started, what's changed since, what makes it better or worse.",
  },
  {
    key: "medical",
    heading: "MEDICAL HISTORY",
    hint: "Diagnoses, conditions, ongoing care.",
  },
  {
    key: "medications",
    heading: "MEDICATIONS & SUPPLEMENTS",
    hint: "Anything they take regularly, and what for.",
  },
  {
    key: "previousTreatment",
    heading: "PREVIOUS TREATMENT / THERAPIES",
    hint: "Other bodywork, talking therapy, physio — what helped and what didn't.",
  },
  {
    key: "lifestyle",
    heading: "LIFESTYLE, WORK & STRESSORS",
    hint: "Work and posture, sleep, exercise, what's loading them at the moment.",
  },
  {
    key: "birthDevelopment",
    heading: "BIRTH & DEVELOPMENTAL HISTORY",
    hint: "Birth, early years, anything developmental worth holding in mind.",
  },
  {
    key: "injuries",
    heading: "INJURIES, ACCIDENTS & SURGERY",
    hint: "Falls, whiplash, dental work, operations — with rough dates.",
  },
  {
    key: "redFlags",
    heading: "RED FLAGS / CAUTIONS",
    hint: "Anything to work around, refer on, or keep an eye on.",
  },
  {
    key: "goals",
    heading: "GOALS — WHAT THEY WANT FROM THE WORK",
    hint: "What a good outcome looks like to them.",
  },
  {
    key: "plan",
    heading: "TREATMENT PLAN",
    hint: "Frequency, approach, what to review and when.",
  },
] as const;

export type NarrativeKey = (typeof NARRATIVE_SECTIONS)[number]["key"];

export const NARRATIVE_KEYS = NARRATIVE_SECTIONS.map((s) => s.key) as NarrativeKey[];

/** Numbering: 1 is the intake form, 2–12 the narrative, then the log and consent. */
const FIRST_NARRATIVE_NUMBER = 2;
const SESSION_LOG_NUMBER = FIRST_NARRATIVE_NUMBER + NARRATIVE_SECTIONS.length; // 13
const CONSENT_NUMBER = SESSION_LOG_NUMBER + 1; // 14

export const CASE_HISTORY_TITLE_PREFIX = "CASE HISTORY — ";
export const INTAKE_HEADING = "1. INTAKE FORM";
export const SESSION_LOG_HEADING = `${SESSION_LOG_NUMBER}. SESSION LOG`;
export const CONSENT_HEADING = `${CONSENT_NUMBER}. CONSENT & DATA`;

/**
 * Marks the untouched copy of a Doc's contents from before it was reformatted.
 * Also how a re-run recognises the tail it must carry through rather than
 * fold into itself again.
 */
export const ORIGINAL_RECORD_HEADING = "ORIGINAL RECORD — BEFORE REFORMATTING";

const ORIGINAL_RECORD_HINT =
  "Everything this Doc held before it was reformatted, kept word for word. Nothing above replaces it — delete this section once you're happy the record above is complete.";

export function narrativeHeading(key: NarrativeKey): string {
  const index = NARRATIVE_SECTIONS.findIndex((s) => s.key === key);
  return `${FIRST_NARRATIVE_NUMBER + index}. ${NARRATIVE_SECTIONS[index].heading}`;
}

/* ---------- stored shapes ---------- */

/** One intake answer, kept with the label the client actually saw. */
export interface IntakeItem {
  label: string;
  value: string;
  group: "details" | "health" | "custom" | "caseHistory";
}

export interface IntakeSnapshot {
  items: IntakeItem[];
  consent: boolean | null;
}

/** A session recovered from an old Doc's text — not one of ours in the database. */
export interface PriorSession {
  date: string;
  text: string;
}

export type CaseHistory = Partial<Record<NarrativeKey, string>> & {
  priorSessions?: PriorSession[];
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validate whatever is on `Client.caseHistory` — it's Json, so trust nothing. */
export function resolveCaseHistory(raw: unknown): CaseHistory {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: CaseHistory = {};
  for (const key of NARRATIVE_KEYS) {
    const value = str(input[key]);
    if (value) out[key] = value;
  }
  if (Array.isArray(input.priorSessions)) {
    const sessions = input.priorSessions
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({ date: str(s.date), text: str(s.text) }))
      .filter((s) => s.text);
    if (sessions.length) out.priorSessions = sessions;
  }
  return out;
}

/** Validate whatever is on `Client.intakeAnswers`. */
export function resolveIntakeSnapshot(raw: unknown): IntakeSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (!Array.isArray(input.items)) return null;
  const groups = new Set(["details", "health", "custom", "caseHistory"]);
  const items: IntakeItem[] = input.items
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => ({
      label: str(i.label),
      value: str(i.value),
      group: (groups.has(String(i.group)) ? i.group : "custom") as IntakeItem["group"],
    }))
    .filter((i) => i.label);
  if (!items.length) return null;
  return { items, consent: typeof input.consent === "boolean" ? input.consent : null };
}

/**
 * Parts of the intake inform the case history: an answer the client has already
 * given shouldn't have to be typed again. Each seeded section is attributed, so
 * it's obvious what came from the form and what Phoenix has since written — and
 * a section that already has something in it is never overwritten.
 */
export function seedFromIntake(existing: CaseHistory, snapshot: IntakeSnapshot, submitted: Date): CaseHistory {
  const from = `[From the intake form, ${fmtDate(submitted)}]`;
  const answer = (match: RegExp, group?: IntakeItem["group"]) =>
    snapshot.items.find((i) => (group ? i.group === group : true) && match.test(i.label))?.value ?? "";

  const seeds: Array<[NarrativeKey, string]> = [
    ["presenting", snapshot.items.find((i) => i.group === "caseHistory")?.value ?? ""],
    ["medical", answer(/condition|injur|health/i, "health")],
    ["medications", answer(/medicat|supplement|drug/i, "health")],
    ["lifestyle", answer(/occupation|work|job/i, "details")],
  ];

  const out: CaseHistory = { ...existing };
  for (const [key, value] of seeds) {
    if (!value.trim() || out[key]?.trim()) continue;
    out[key] = `${from}\n${value.trim()}`;
  }
  return out;
}

/** Has anything been recorded in the clinical sections yet? */
export function hasNarrative(history: CaseHistory): boolean {
  return NARRATIVE_KEYS.some((key) => !!history[key]?.trim());
}

/**
 * Fold what was read out of an old Doc into the case history, filling only the
 * sections that are still empty. Anything already recorded — typed by hand, or
 * seeded from the intake form — wins over a re-read of the old text.
 * Returns the merged history and the section headings it actually filled.
 */
export function applyExtract(
  existing: CaseHistory,
  extract: Partial<Record<NarrativeKey, string>> & { priorSessions?: PriorSession[] },
): { history: CaseHistory; filled: string[] } {
  const history: CaseHistory = { ...existing };
  const filled: string[] = [];

  for (const key of NARRATIVE_KEYS) {
    const value = str(extract[key]);
    if (!value || history[key]?.trim()) continue;
    history[key] = value;
    filled.push(narrativeHeading(key));
  }

  const prior = (extract.priorSessions ?? []).map((s) => ({ date: str(s.date), text: str(s.text) })).filter((s) => s.text);
  if (prior.length && !history.priorSessions?.length) history.priorSessions = prior;

  return { history, filled };
}

/* ---------- building the Doc ---------- */

export interface CaseHistoryInput {
  client: {
    name: string;
    email: string;
    phone: string;
    dob: string;
    occupation: string;
    doctor: string;
    emergency: string;
    referred: string;
    clinic: string;
    paymentRef: string;
    consentGiven: boolean | null;
    marketing: boolean;
    createdAt: Date;
  };
  history: CaseHistory;
  intake: { snapshot: IntakeSnapshot | null; submittedAt: Date | null };
  sessions: Array<{ date: Date; clinic: string; bullets: string[]; raw: string }>;
  firstSeen: Date | null;
  sessionCount: number;
  /** The Doc's contents from before a reformat, kept whole at the bottom. */
  originalRecord?: string;
}

const clinicLabel = (clinic: string) => CLINIC_LABEL[clinic as Clinic] ?? CLINIC_LABEL.waterloo;

function atAGlance(input: CaseHistoryInput): DocSection {
  const c = input.client;
  return {
    heading: "AT A GLANCE",
    lines: [
      { kind: "field", label: "Name", value: c.name },
      { kind: "field", label: "Date of birth", value: c.dob },
      { kind: "field", label: "Phone", value: c.phone },
      { kind: "field", label: "Email", value: c.email },
      { kind: "field", label: "Occupation", value: c.occupation },
      { kind: "field", label: "GP / doctor", value: c.doctor },
      { kind: "field", label: "Emergency contact", value: c.emergency },
      { kind: "field", label: "Referred by", value: c.referred },
      { kind: "field", label: "Usual clinic", value: clinicLabel(c.clinic) },
      { kind: "field", label: "First seen", value: input.firstSeen ? fmtDate(input.firstSeen) : "Not yet seen" },
      { kind: "field", label: "Sessions to date", value: String(input.sessionCount) },
      { kind: "field", label: "Payment reference", value: c.paymentRef },
    ],
  };
}

/** Section 1 — the intake form as submitted, reproduced rather than summarised. */
function intakeSection(input: CaseHistoryInput): DocSection {
  const { snapshot, submittedAt } = input.intake;
  const heading = submittedAt
    ? `${INTAKE_HEADING} — submitted ${fmtDate(submittedAt)}`
    : `${INTAKE_HEADING} — not yet returned`;

  if (!snapshot) {
    return {
      heading,
      lines: [
        {
          kind: "hint",
          value:
            "This client hasn't submitted the intake form through the app. Their details are in AT A GLANCE above; anything else known about them is in the sections below.",
        },
      ],
    };
  }

  const lines: DocLine[] = [];
  const block = (title: string, group: IntakeItem["group"], long: boolean, showLabel = true) => {
    const items = snapshot.items.filter((i) => i.group === group);
    if (!items.length) return;
    lines.push({ kind: "subheading", value: title });
    for (const item of items) {
      lines.push(
        long
          ? { kind: "paragraph", label: showLabel ? item.label : undefined, value: item.value }
          : { kind: "field", label: item.label, value: item.value },
      );
    }
  };

  block("1.1 Client details", "details", false);
  block("1.2 Health information", "health", true);
  // The question itself is the subheading here — no need to print it twice.
  block("1.3 What brings them to therapy", "caseHistory", true, false);
  block("1.4 Additional questions", "custom", true);

  lines.push({ kind: "subheading", value: "1.5 Consent" });
  lines.push({
    kind: "field",
    label: "Consent given",
    value: snapshot.consent === true ? "Yes" : snapshot.consent === false ? "No" : "Not answered",
  });
  lines.push({ kind: "paragraph", value: CONSENT_PARAGRAPHS.join("\n\n") });

  return { heading, lines };
}

/** Sections 2–12, each either the recorded narrative or its prompt. */
function narrativeSections(history: CaseHistory): DocSection[] {
  return NARRATIVE_SECTIONS.map((section, i) => {
    const value = history[section.key]?.trim();
    return {
      heading: `${FIRST_NARRATIVE_NUMBER + i}. ${section.heading}`,
      lines: [value ? { kind: "paragraph", value } : { kind: "hint", value: section.hint }] as DocLine[],
    };
  });
}

/** One entry in the session log — also what gets spliced in when a note is saved. */
export function sessionEntry(note: { date: Date; clinic: string; bullets: string[]; raw: string }): DocSection {
  return {
    heading: `${fmtDate(note.date)} · ${clinicLabel(note.clinic)}`,
    lines: [
      ...(note.bullets.length ? [{ kind: "bullets" as const, label: "Summary", items: note.bullets }] : []),
      { kind: "paragraph" as const, label: "Note", value: note.raw },
    ],
  };
}

function sessionLogSection(input: CaseHistoryInput): DocSection {
  const lines: DocLine[] = [];
  if (!input.sessions.length && !input.history.priorSessions?.length) {
    lines.push({ kind: "hint", value: "No sessions recorded yet. New notes are added here, newest first." });
  } else {
    lines.push({ kind: "hint", value: "Newest first." });
  }
  return { heading: SESSION_LOG_HEADING, lines };
}

/** Sessions render as their own sections so each one is an outline entry. */
function sessionSections(input: CaseHistoryInput): DocSection[] {
  const own = [...input.sessions]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map((note) => sessionEntry(note));

  const prior = (input.history.priorSessions ?? []).map((s) => ({
    heading: s.date ? `${s.date} · from the original record` : "Undated · from the original record",
    lines: [{ kind: "verbatim" as const, value: s.text }],
  }));

  return [...own, ...prior];
}

function consentSection(input: CaseHistoryInput): DocSection {
  const c = input.client;
  const snapshotConsent = input.intake.snapshot?.consent;
  const consent = typeof c.consentGiven === "boolean" ? c.consentGiven : snapshotConsent;
  return {
    heading: CONSENT_HEADING,
    lines: [
      {
        kind: "field",
        label: "Consent to treatment & record keeping",
        value: consent === true ? "Given" : consent === false ? "Declined" : "Not yet answered",
      },
      {
        kind: "field",
        label: "Consent date",
        value: input.intake.submittedAt ? fmtDate(input.intake.submittedAt) : "—",
      },
      { kind: "field", label: "Email marketing", value: c.marketing ? "Opted in" : "Not opted in" },
      { kind: "paragraph", label: "Wording agreed to", value: CONSENT_PARAGRAPHS.join("\n\n") },
    ],
  };
}

/** The whole Doc: title, then every section in the standard order. */
export function buildCaseHistoryDoc(input: CaseHistoryInput): { title: { text: string; subtitle: string }; sections: DocSection[] } {
  const sections: DocSection[] = [
    atAGlance(input),
    intakeSection(input),
    ...narrativeSections(input.history),
    sessionLogSection(input),
    ...sessionSections(input),
    consentSection(input),
  ];

  if (input.originalRecord?.trim()) {
    sections.push({
      heading: ORIGINAL_RECORD_HEADING,
      lines: [
        { kind: "hint", value: ORIGINAL_RECORD_HINT },
        { kind: "verbatim", value: input.originalRecord },
      ],
    });
  }

  return {
    title: {
      text: `${CASE_HISTORY_TITLE_PREFIX}${input.client.name}`,
      subtitle: `CSTL · Phoenix Tanner · craniosacral therapy — updated ${fmtDate(new Date())}`,
    },
    sections,
  };
}

/* ---------- loading and writing ---------- */

/** Gather everything the layout needs for one client. */
export async function loadCaseHistoryInput(
  clientId: string,
  originalRecord?: string,
): Promise<CaseHistoryInput> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const [notes, firstBooking, sessionCount] = await Promise.all([
    prisma.sessionNote.findMany({ where: { clientId }, orderBy: { date: "desc" } }),
    prisma.booking.findFirst({
      where: { clientId, status: { not: "cancelled" } },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    }),
    prisma.booking.count({ where: { clientId, status: { not: "cancelled" }, startsAt: { lt: new Date() } } }),
  ]);

  return {
    client,
    history: resolveCaseHistory(client.caseHistory),
    intake: {
      snapshot: resolveIntakeSnapshot(client.intakeAnswers),
      submittedAt: client.intakeSubmittedAt,
    },
    sessions: notes.map((n) => ({ date: n.date, clinic: n.clinic, bullets: n.bullets, raw: n.raw })),
    firstSeen: firstBooking?.startsAt ?? (notes.length ? notes[notes.length - 1].date : null),
    sessionCount,
    originalRecord,
  };
}

/**
 * Write a client's Doc out in the standard layout, replacing what's there.
 *
 * Destructive by design — it's how a Doc is brought onto the layout and kept on
 * it — so callers either own the Doc's contents already (a Doc we just created)
 * or have captured what was there into `originalRecord` first.
 */
export async function renderCaseHistoryDoc(clientId: string, docId: string, originalRecord?: string) {
  const input = await loadCaseHistoryInput(clientId, originalRecord);
  const { title, sections } = buildCaseHistoryDoc(input);
  await rebuildDoc(docId, title, sections);
}

/**
 * Add a session note to the Doc. Lands at the top of the session log on a Doc
 * that's on the layout; falls back to appending at the end on one that isn't,
 * so a note is never lost to an un-reformatted Doc.
 */
export async function addSessionToDoc(
  docId: string,
  note: { date: Date; clinic: string; bullets: string[]; raw: string },
) {
  const section = sessionEntry(note);
  const placed = await insertSectionsUnderHeading(docId, SESSION_LOG_HEADING, [section]);
  if (!placed) await appendFormattedSections(docId, null, [section]);
}

/** Add any pre-built block to the session log — used by the Clean Language save. */
export async function addSectionToSessionLog(docId: string, section: DocSection) {
  const placed = await insertSectionsUnderHeading(docId, SESSION_LOG_HEADING, [section]);
  if (!placed) await appendFormattedSections(docId, null, [section]);
}

/** Bring the "at a glance" block back in line with the client's record. */
export async function refreshAtAGlance(clientId: string, docId: string): Promise<boolean> {
  const input = await loadCaseHistoryInput(clientId);
  return replaceSectionUnderHeading(docId, "AT A GLANCE", atAGlance(input));
}

/** A Doc we wrote reads as one — it opens with the case-history title. */
export function isOnLayout(docText: string): boolean {
  return docText.includes(CASE_HISTORY_TITLE_PREFIX) && docText.includes(SESSION_LOG_HEADING);
}

/** The near-empty placeholder a Doc is created with — not a record worth keeping. */
const NEW_DOC_BOILERPLATE = "— CSTL client record";

/**
 * Whatever a Doc holds that the layout doesn't account for, ready to be carried
 * through a rebuild.
 *
 * On a Doc that's never been reformatted that's the entire contents. On one
 * that has, it's the ORIGINAL RECORD tail from the first reformat — captured
 * once and passed along unchanged, so re-running never buries a copy of the
 * record inside a copy of the record.
 */
export function originalRecordFrom(docText: string): string {
  const markerAt = docText.indexOf(ORIGINAL_RECORD_HEADING);
  if (markerAt !== -1) {
    const tail = docText.slice(markerAt + ORIGINAL_RECORD_HEADING.length);
    return tail.replace(ORIGINAL_RECORD_HINT, "").trim();
  }

  if (isOnLayout(docText)) return "";
  if (docText.includes(NEW_DOC_BOILERPLATE) && docText.trim().length < 200) return "";
  return docText.trim();
}

/** `originalRecordFrom` against the live Doc. */
export async function captureOriginalRecord(docId: string): Promise<string> {
  return originalRecordFrom(await getDocPlainText(docId));
}

/**
 * Rewrite the Doc from the app's record of this client, keeping anything that
 * was in it beforehand under ORIGINAL RECORD. The safe way to re-render: no
 * pre-existing wording is dropped, whether or not the Doc was on the layout.
 */
export async function refreshCaseHistoryDoc(clientId: string, docId: string, alsoKeep?: string) {
  const kept = await captureOriginalRecord(docId);
  const original = [kept, alsoKeep?.trim()].filter(Boolean).join("\n\n");
  await renderCaseHistoryDoc(clientId, docId, original);
}
