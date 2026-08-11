/**
 * Reading and writing a client's case history — the record in the database, and
 * the Google Doc that renders it.
 *
 * The layout itself (which headers, in which order, with which boxes) lives in
 * caseHistoryLayout.ts. The Doc is a *rendering* of `Client.caseHistory` plus
 * their session notes, which is what lets an old free-text Doc be rebuilt into
 * the standard shape — and rebuilt again later — and what lets the history be
 * edited in the app rather than only in Drive.
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
import {
  allEntryKeys,
  CASE_HISTORY_SECTIONS,
  CASE_HISTORY_TITLE_PREFIX,
  CONSENT_HEADING,
  entryKey,
  INTAKE_HEADING,
  isEntryKey,
  ORIGINAL_RECORD_HEADING,
  ORIGINAL_RECORD_HINT,
  sectionHeading,
  SESSION_LOG_HEADING,
} from "@/lib/caseHistoryLayout";

export * from "@/lib/caseHistoryLayout";

/* ---------- stored shapes ---------- */

/** One intake answer, kept with the label the client actually saw. */
export interface IntakeItem {
  label: string;
  value: string;
  group: "details" | "health" | "custom" | "caseHistory";
  /** The case history box this answer feeds, captured at submission time so the
   *  mapping survives the question later being reworded or removed. */
  caseKey?: string;
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

export interface CaseHistory {
  /** Keyed by entry key: "diet", "family.mother". Only non-empty boxes are kept. */
  entries: Record<string, string>;
  priorSessions?: PriorSession[];
}

/** A session as the Doc shows it — the four things recorded each time. */
export interface SessionEntry {
  date: Date;
  clinic: string;
  bullets: string[];
  /** how they'd been since the last session */
  between: string;
  /** the session note itself */
  raw: string;
  /** Phoenix's reflections on the session */
  reflections: string;
  /** thoughts for next time */
  nextSession: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validate whatever is on `Client.caseHistory` — it's Json, so trust nothing. */
export function resolveCaseHistory(raw: unknown): CaseHistory {
  const empty: CaseHistory = { entries: {} };
  if (!raw || typeof raw !== "object") return empty;
  const input = raw as Record<string, unknown>;

  const entries: Record<string, string> = {};
  const source = (input.entries && typeof input.entries === "object" ? input.entries : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    const text = str(value);
    if (text && isEntryKey(key)) entries[key] = text;
  }

  const out: CaseHistory = { entries };
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
    .map((i) => {
      const caseKey = str(i.caseKey);
      return {
        label: str(i.label),
        value: str(i.value),
        group: (groups.has(String(i.group)) ? i.group : "custom") as IntakeItem["group"],
        ...(caseKey && isEntryKey(caseKey) ? { caseKey } : {}),
      };
    })
    .filter((i) => i.label);
  if (!items.length) return null;
  return { items, consent: typeof input.consent === "boolean" ? input.consent : null };
}

/** Has anything been written into the case history yet? */
export function hasHistory(history: CaseHistory): boolean {
  return Object.keys(history.entries).length > 0;
}

/**
 * Only keep boxes that exist and have something in them — how an edit from the
 * app is cleaned before it's stored, so a renamed section can't leave orphans
 * behind and a cleared box disappears rather than lingering as "".
 */
export function cleanEntries(input: Record<string, unknown>): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const key of allEntryKeys()) {
    const value = str(input[key]);
    if (value) entries[key] = value;
  }
  return entries;
}

/**
 * The intake form informs the case history: an answer already given seeds the
 * box it answers, attributed to the form so it's clear what came from the
 * client and what Phoenix has since written. A box already filled is never
 * written over.
 *
 * The mapping is carried on the questions themselves (`caseKey`), not guessed
 * from their wording, so re-wording a question in Settings can't silently
 * detach it from the section it feeds.
 */
export function seedFromIntake(
  existing: CaseHistory,
  snapshot: IntakeSnapshot,
  submitted: Date,
): CaseHistory {
  const from = `[From the intake form, ${fmtDate(submitted)}]`;
  const entries = { ...existing.entries };

  for (const item of snapshot.items) {
    const key = item.caseKey;
    const value = str(item.value);
    if (!key || !value || !isEntryKey(key) || entries[key]?.trim()) continue;
    entries[key] = `${from}\n${value}`;
  }

  return { ...existing, entries };
}

/**
 * Fold what was read out of an old Doc into the case history, filling only the
 * boxes that are still empty. Anything already recorded wins over a re-read.
 * Returns the merged history and the headings it actually filled.
 */
export function applyExtract(
  existing: CaseHistory,
  extract: { entries?: Record<string, unknown>; priorSessions?: PriorSession[] },
): { history: CaseHistory; filled: string[] } {
  const entries = { ...existing.entries };
  const filled: string[] = [];

  for (const [key, raw] of Object.entries(extract.entries ?? {})) {
    const value = str(raw);
    if (!value || !isEntryKey(key) || entries[key]?.trim()) continue;
    entries[key] = value;
    filled.push(key);
  }

  const history: CaseHistory = { ...existing, entries };
  const prior = (extract.priorSessions ?? [])
    .map((s) => ({ date: str(s.date), text: str(s.text) }))
    .filter((s) => s.text);
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
  sessions: SessionEntry[];
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
  block("1.2 Their history, in their words", "caseHistory", true);
  block("1.3 Health information", "health", true);
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

/** Sections 2–12: an open box, or the section's named boxes. */
function historySections(history: CaseHistory): DocSection[] {
  return CASE_HISTORY_SECTIONS.map((section) => {
    const heading = sectionHeading(section.key);

    if (!section.fields) {
      const value = history.entries[entryKey(section.key)]?.trim();
      return { heading, lines: [value ? { kind: "paragraph", value } : { kind: "hint", value: section.hint }] };
    }

    const written = section.fields.filter((f) => history.entries[entryKey(section.key, f.key)]?.trim());
    if (!written.length) {
      return { heading, lines: [{ kind: "hint", value: section.hint }] };
    }
    // Only the boxes with something in them — an empty "Wife:" on every record
    // is noise, and the box is still there in the app when it's needed.
    return {
      heading,
      lines: written.map((f) => ({
        kind: "paragraph" as const,
        label: f.label,
        value: history.entries[entryKey(section.key, f.key)],
      })),
    };
  });
}

/** One entry in the session log — also what gets spliced in when a note is saved. */
export function sessionEntry(note: SessionEntry): DocSection {
  const lines: DocLine[] = [];
  if (note.bullets.length) lines.push({ kind: "bullets", label: "Summary", items: note.bullets });
  if (note.between.trim()) {
    lines.push({ kind: "paragraph", label: "How they'd been between sessions", value: note.between });
  }
  lines.push({ kind: "paragraph", label: "Session notes", value: note.raw });
  if (note.reflections.trim()) {
    lines.push({ kind: "paragraph", label: "Session reflections", value: note.reflections });
  }
  if (note.nextSession.trim()) {
    lines.push({ kind: "paragraph", label: "Thoughts for next session", value: note.nextSession });
  }

  return { heading: `${fmtDate(note.date)} · ${clinicLabel(note.clinic)}`, lines };
}

function sessionLogSection(input: CaseHistoryInput): DocSection {
  const empty = !input.sessions.length && !input.history.priorSessions?.length;
  return {
    heading: SESSION_LOG_HEADING,
    lines: [
      {
        kind: "hint",
        value: empty
          ? "No sessions recorded yet. New notes are added here, newest first."
          : "Newest first.",
      },
    ],
  };
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
  const consent = typeof c.consentGiven === "boolean" ? c.consentGiven : input.intake.snapshot?.consent;
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
export function buildCaseHistoryDoc(input: CaseHistoryInput): {
  title: { text: string; subtitle: string };
  sections: DocSection[];
} {
  const sections: DocSection[] = [
    atAGlance(input),
    intakeSection(input),
    ...historySections(input.history),
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
    sessions: notes.map((n) => ({
      date: n.date,
      clinic: n.clinic,
      bullets: n.bullets,
      between: n.between,
      raw: n.raw,
      reflections: n.reflections,
      nextSession: n.nextSession,
    })),
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
 * or have captured what was there into `originalRecord` first. Prefer
 * `refreshCaseHistoryDoc`, which captures for you.
 */
export async function renderCaseHistoryDoc(clientId: string, docId: string, originalRecord?: string) {
  const input = await loadCaseHistoryInput(clientId, originalRecord);
  const { title, sections } = buildCaseHistoryDoc(input);
  await rebuildDoc(docId, title, sections);
}

/**
 * Add a session to the Doc. Lands at the top of the session log on a Doc that's
 * on the layout; falls back to appending at the end on one that isn't, so a
 * note is never lost to an un-reformatted Doc.
 */
export async function addSessionToDoc(docId: string, note: SessionEntry) {
  await addSectionToSessionLog(docId, sessionEntry(note));
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
