import { describe, it, expect } from "vitest";
import {
  allEntryKeys,
  applyExtract,
  buildCaseHistoryDoc,
  CASE_HISTORY_TITLE_PREFIX,
  cleanEntries,
  entryLabel,
  hasHistory,
  isEntryKey,
  isOnLayout,
  ORIGINAL_RECORD_HEADING,
  originalRecordFrom,
  resolveCaseHistory,
  resolveIntakeSnapshot,
  seedFromIntake,
  sectionHeading,
  SESSION_LOG_HEADING,
  type CaseHistory,
  type CaseHistoryInput,
  type IntakeSnapshot,
  type SessionEntry,
} from "./caseHistory";
import { DEFAULT_INTAKE_QUESTIONS, resolveIntakeQuestions } from "./intakeQuestions";
import { renderSections } from "./google/docFormat";

const SUBMITTED = new Date("2026-07-04T10:00:00Z");

const history = (entries: Record<string, string> = {}, over: Partial<CaseHistory> = {}): CaseHistory => ({
  entries,
  ...over,
});

const snapshot = (over: Partial<IntakeSnapshot> = {}): IntakeSnapshot => ({
  items: [
    { label: "Full name", value: "Jane Doe", group: "details" },
    { label: "Occupation", value: "Nurse", group: "details" },
    {
      label: "What's brought you here",
      value: "Neck pain since a car accident, and I can't switch off.",
      group: "caseHistory",
      caseKey: "reasons",
    },
    {
      label: "Accidents and injuries — older ones",
      value: "Fell off a horse at 12.",
      group: "caseHistory",
      caseKey: "accidents.old",
    },
    { label: "Mother", value: "Rheumatoid arthritis.", group: "caseHistory", caseKey: "family.mother" },
    { label: "Smoking", value: "Gave up 2019.", group: "caseHistory", caseKey: "drugs.smoking" },
  ],
  consent: true,
  ...over,
});

const session = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  date: new Date("2026-08-01T10:00:00Z"),
  clinic: "waterloo",
  bullets: [],
  between: "",
  raw: "Worked at the sacrum.",
  reflections: "",
  nextSession: "",
  ...over,
});

function input(over: Partial<CaseHistoryInput> = {}): CaseHistoryInput {
  return {
    client: {
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "07700 900000",
      dob: "1990-01-01",
      occupation: "Nurse",
      doctor: "Dr Smith, Riverside Surgery",
      emergency: "Sam Doe 07700 900001",
      referred: "A friend",
      clinic: "bethnal",
      paymentRef: "JANE-4K2",
      consentGiven: true,
      marketing: false,
      createdAt: SUBMITTED,
    },
    history: history(),
    intake: { snapshot: null, submittedAt: null },
    sessions: [],
    firstSeen: null,
    sessionCount: 0,
    ...over,
  };
}

const headingsOf = (built: ReturnType<typeof buildCaseHistoryDoc>) => built.sections.map((s) => s.heading);
const textOf = (built: ReturnType<typeof buildCaseHistoryDoc>) =>
  renderSections(built.sections, { title: built.title }).text;

describe("the case history sheet", () => {
  it("has every header off the form, numbered, in order", () => {
    expect(headingsOf(buildCaseHistoryDoc(input()))).toEqual([
      "AT A GLANCE",
      "1. INTAKE FORM — not yet returned",
      "2. REASONS FOR COMING / SYMPTOMS",
      "3. HISTORY",
      "4. ACCIDENTS AND INJURIES",
      "5. SURGERY / ILLNESS / HOSPITAL / TRAUMA / STRESS",
      "6. FAMILY",
      "7. DRUGS",
      "8. DIET",
      "9. BIRTH",
      "10. DENTISTRY",
      "11. BODY LANGUAGE",
      "12. ADDITIONAL INFORMATION — where are we and where would you like to go",
      SESSION_LOG_HEADING,
      "14. CONSENT & DATA",
    ]);
  });

  it("puts the intake form at the top, above the history", () => {
    const headings = headingsOf(buildCaseHistoryDoc(input({ intake: { snapshot: snapshot(), submittedAt: SUBMITTED } })));

    expect(headings.indexOf("1. INTAKE FORM — submitted 4 Jul 2026")).toBe(1);
    expect(headings.indexOf("1. INTAKE FORM — submitted 4 Jul 2026")).toBeLessThan(
      headings.indexOf("2. REASONS FOR COMING / SYMPTOMS"),
    );
  });

  it("knows every box on the sheet, and nothing else", () => {
    const keys = allEntryKeys();

    expect(keys).toContain("diet");
    expect(keys).toContain("accidents.old");
    expect(keys).toContain("family.siblings");
    expect(keys).toContain("drugs.alcohol");
    expect(isEntryKey("family.mother")).toBe(true);
    expect(isEntryKey("family.dog")).toBe(false);
    expect(isEntryKey("presenting")).toBe(false); // the old invented section
  });

  it("labels a box by its own name, not its section's", () => {
    expect(entryLabel("family.mother")).toBe("Mother");
    expect(entryLabel("accidents.new")).toBe("New");
    expect(entryLabel("diet")).toBe("DIET");
  });

  it("splits accidents and surgery into old and new", () => {
    const built = buildCaseHistoryDoc(
      input({
        history: history({
          "accidents.old": "Fell off a horse at 12.",
          "accidents.new": "Rear-ended in March.",
          "surgery.old": "Appendix out, 2004.",
        }),
      }),
    );
    const text = textOf(built);

    expect(text).toContain("Old:\nFell off a horse at 12.");
    expect(text).toContain("New:\nRear-ended in March.");
    expect(text).toContain("Old:\nAppendix out, 2004.");
    // The box that was never filled isn't printed as an empty prompt.
    expect(text).not.toContain("New:\n—");
  });

  it("prints the family and drugs boxes that have been filled", () => {
    const text = textOf(
      buildCaseHistoryDoc(
        input({
          history: history({
            "family.mother": "Rheumatoid arthritis.",
            "family.siblings": "One brother, well.",
            "drugs.present": "Sertraline 50mg.",
            "drugs.alcohol": "A glass of wine at weekends.",
          }),
        }),
      ),
    );

    expect(text).toContain("Mother:\nRheumatoid arthritis.");
    expect(text).toContain("Siblings:\nOne brother, well.");
    expect(text).toContain("Present:\nSertraline 50mg.");
    expect(text).toContain("Alcohol:\nA glass of wine at weekends.");
    expect(text).not.toContain("Wife:");
  });

  it("prompts rather than leaving a bare header when a section is empty", () => {
    const built = buildCaseHistoryDoc(input());

    for (const heading of ["2. REASONS FOR COMING / SYMPTOMS", "6. FAMILY", "9. BIRTH"]) {
      const section = built.sections.find((s) => s.heading === heading)!;
      expect(section.lines[0].kind).toBe("hint");
    }
  });

  it("titles the Doc for the client and reads as being on the layout", () => {
    const built = buildCaseHistoryDoc(input());

    expect(built.title.text).toBe(`${CASE_HISTORY_TITLE_PREFIX}Jane Doe`);
    expect(isOnLayout(textOf(built))).toBe(true);
  });
});

describe("the session log", () => {
  it("carries all four things recorded each session", () => {
    const text = textOf(
      buildCaseHistoryDoc(
        input({
          sessions: [
            session({
              between: "Slept better, neck stiff again by Thursday.",
              raw: "Long stillpoint at the occipital base.",
              reflections: "I was rushing at the start.",
              nextSession: "Start at the feet.",
            }),
          ],
        }),
      ),
    );

    expect(text).toContain("How they'd been between sessions:\nSlept better");
    expect(text).toContain("Session notes:\nLong stillpoint");
    expect(text).toContain("Session reflections:\nI was rushing");
    expect(text).toContain("Thoughts for next session:\nStart at the feet.");
  });

  it("leaves out the three extras when only a note was written", () => {
    const text = textOf(buildCaseHistoryDoc(input({ sessions: [session()] })));

    expect(text).toContain("Session notes:");
    expect(text).not.toContain("How they'd been between sessions:");
    expect(text).not.toContain("Thoughts for next session:");
  });

  it("logs sessions newest first, each its own outline entry", () => {
    const built = buildCaseHistoryDoc(
      input({
        sessions: [
          session({ date: new Date("2026-07-10T10:00:00Z"), clinic: "bethnal" }),
          session({ date: new Date("2026-08-01T10:00:00Z"), clinic: "waterloo" }),
        ],
      }),
    );

    const logAt = headingsOf(built).indexOf(SESSION_LOG_HEADING);
    expect(headingsOf(built).slice(logAt + 1, logAt + 3)).toEqual([
      "1 Aug 2026 · Waterloo",
      "10 Jul 2026 · Bethnal Green",
    ]);
  });

  it("keeps sessions recovered from an old record in the log, marked as such", () => {
    const built = buildCaseHistoryDoc(
      input({ history: history({}, { priorSessions: [{ date: "March 2025", text: "Occipital base." }] }) }),
    );

    expect(headingsOf(built)).toContain("March 2025 · from the original record");
  });
});

describe("the intake form informing the case history", () => {
  it("seeds each box from the question mapped to it, and says where it came from", () => {
    const seeded = seedFromIntake(history(), snapshot(), SUBMITTED);

    expect(seeded.entries.reasons).toContain("Neck pain since a car accident");
    expect(seeded.entries["accidents.old"]).toContain("Fell off a horse at 12.");
    expect(seeded.entries["family.mother"]).toContain("Rheumatoid arthritis.");
    expect(seeded.entries["drugs.smoking"]).toContain("Gave up 2019.");
    expect(seeded.entries.reasons).toContain("[From the intake form, 4 Jul 2026]");
  });

  it("leaves boxes the form says nothing about empty", () => {
    const seeded = seedFromIntake(history(), snapshot(), SUBMITTED);

    expect(seeded.entries.birth).toBeUndefined();
    expect(seeded.entries["family.father"]).toBeUndefined();
  });

  it("never writes over something already recorded", () => {
    const seeded = seedFromIntake(history({ reasons: "Written up after our first session." }), snapshot(), SUBMITTED);

    expect(seeded.entries.reasons).toBe("Written up after our first session.");
  });

  it("ignores an answer left blank, and an answer mapped to nothing", () => {
    const blank = snapshot({
      items: [
        { label: "Mother", value: "", group: "caseHistory", caseKey: "family.mother" },
        { label: "Occupation", value: "Nurse", group: "details" },
      ],
    });

    expect(seedFromIntake(history(), blank, SUBMITTED).entries).toEqual({});
  });

  it("maps every default intake question at a real box on the sheet", () => {
    const mapped = DEFAULT_INTAKE_QUESTIONS.filter((q) => q.caseKey);

    expect(mapped.length).toBeGreaterThan(10);
    for (const q of mapped) expect(isEntryKey(q.caseKey!)).toBe(true);
  });

  it("asks for the history the sheet needs, so it isn't taken in the room", () => {
    const asked = new Set(DEFAULT_INTAKE_QUESTIONS.map((q) => q.caseKey));

    for (const key of ["reasons", "history", "accidents.old", "surgery.old", "diet", "birth", "dentistry"]) {
      expect(asked).toContain(key);
    }
    // Observed in the room, not something to ask a client for.
    expect(asked).not.toContain("bodyLanguage");
  });

  it("drops a stored question whose box no longer exists", () => {
    const resolved = resolveIntakeQuestions([
      { key: "a", label: "Still mapped", type: "long", caseKey: "diet" },
      { key: "b", label: "Points at a removed section", type: "long", caseKey: "presenting" },
    ]);

    expect(resolved[0].caseKey).toBe("diet");
    expect(resolved[1].caseKey).toBeUndefined();
  });
});

describe("sorting an old Doc into the sheet", () => {
  const extract = {
    entries: { reasons: "Headaches most afternoons.", "accidents.old": "Fell off a bike, 2019." },
    priorSessions: [{ date: "2 Feb 2025", text: "Long stillpoint at the sacrum." }],
  };

  it("fills the empty boxes and reports which", () => {
    const { history: merged, filled } = applyExtract(history(), extract);

    expect(merged.entries.reasons).toBe("Headaches most afternoons.");
    expect(filled).toEqual(["reasons", "accidents.old"]);
  });

  it("does not touch a box that already has something in it", () => {
    const { history: merged, filled } = applyExtract(history({ reasons: "Her own words." }), extract);

    expect(merged.entries.reasons).toBe("Her own words.");
    expect(filled).toEqual(["accidents.old"]);
  });

  it("ignores a box the model invented", () => {
    const { history: merged } = applyExtract(history(), { entries: { horoscope: "Libra" } });

    expect(merged.entries).toEqual({});
  });

  it("carries recovered sessions across, but not over ones already held", () => {
    expect(applyExtract(history(), extract).history.priorSessions).toHaveLength(1);

    const held = history({}, { priorSessions: [{ date: "older", text: "already recovered" }] });
    expect(applyExtract(held, extract).history.priorSessions).toEqual(held.priorSessions);
  });

  it("knows whether anything has been recorded", () => {
    expect(hasHistory(history())).toBe(false);
    expect(hasHistory(history({}, { priorSessions: [{ date: "", text: "x" }] }))).toBe(false);
    expect(hasHistory(history({ diet: "Vegetarian." }))).toBe(true);
  });
});

describe("editing the history in the app", () => {
  it("keeps real boxes, drops unknown ones and clears emptied ones", () => {
    const cleaned = cleanEntries({
      diet: "  Vegetarian.  ",
      "family.mother": "",
      "family.cat": "Tiddles",
      birth: "Forceps.",
    });

    expect(cleaned).toEqual({ diet: "Vegetarian.", birth: "Forceps." });
  });
});

describe("keeping the old record through a rebuild", () => {
  const oldDoc = "Jane Doe\nSaw her in March, neck much freer.\nMeds: none.";
  const reformatted = (original: string) => textOf(buildCaseHistoryDoc(input({ originalRecord: original })));

  it("treats an un-reformatted Doc's whole contents as the record to keep", () => {
    expect(originalRecordFrom(oldDoc)).toBe(oldDoc);
  });

  it("ignores the placeholder text a brand-new Doc is created with", () => {
    expect(originalRecordFrom("Jane Doe — CSTL client record\nCreated 04/07/2026\n\n")).toBe("");
  });

  it("has nothing to keep from a Doc already on the layout with no original", () => {
    expect(originalRecordFrom(reformatted(""))).toBe("");
    expect(headingsOf(buildCaseHistoryDoc(input()))).not.toContain(ORIGINAL_RECORD_HEADING);
  });

  it("recovers the kept record, and always puts it last", () => {
    const built = buildCaseHistoryDoc(input({ originalRecord: oldDoc }));
    expect(headingsOf(built).at(-1)).toBe(ORIGINAL_RECORD_HEADING);

    const kept = originalRecordFrom(textOf(built));
    expect(kept).toContain("Saw her in March, neck much freer.");
    expect(kept).not.toContain(SESSION_LOG_HEADING);
  });

  it("stays the same record however many times it is reformatted", () => {
    const once = originalRecordFrom(reformatted(oldDoc));
    const twice = originalRecordFrom(reformatted(once));

    expect(twice).toBe(once);
    expect(twice.split("Saw her in March")).toHaveLength(2);
  });
});

describe("reading back what was stored", () => {
  it("keeps only real boxes with something in them", () => {
    const resolved = resolveCaseHistory({
      entries: { diet: " Vegetarian ", nonsense: "x", birth: "   " },
    });

    expect(resolved.entries).toEqual({ diet: "Vegetarian" });
  });

  it("shrugs off junk instead of throwing", () => {
    expect(resolveCaseHistory(null).entries).toEqual({});
    expect(resolveCaseHistory("not an object").entries).toEqual({});
    expect(resolveCaseHistory({ entries: "nope" }).entries).toEqual({});
    expect(resolveCaseHistory({ entries: {}, priorSessions: [{ text: "" }, "nope", null] }).priorSessions).toBeUndefined();
    expect(resolveIntakeSnapshot({ items: [] })).toBeNull();
    expect(resolveIntakeSnapshot(undefined)).toBeNull();
  });

  it("keeps an intake snapshot's labels, values, mapping and consent", () => {
    const resolved = resolveIntakeSnapshot({
      items: [
        { label: "Mother", value: "Well", group: "caseHistory", caseKey: "family.mother" },
        { label: "Ghost", value: "x", group: "caseHistory", caseKey: "family.ghost" },
        { label: "", value: "dropped" },
      ],
      consent: true,
    });

    expect(resolved?.items).toEqual([
      { label: "Mother", value: "Well", group: "caseHistory", caseKey: "family.mother" },
      { label: "Ghost", value: "x", group: "caseHistory" },
    ]);
    expect(resolved?.consent).toBe(true);
  });

  it("treats an unanswered consent question as unanswered, not as a no", () => {
    expect(resolveIntakeSnapshot({ items: [{ label: "Phone", value: "", group: "details" }] })?.consent).toBeNull();
  });

  it("numbers a heading by where it sits on the sheet", () => {
    expect(sectionHeading("reasons")).toBe("2. REASONS FOR COMING / SYMPTOMS");
    expect(sectionHeading("additional")).toBe(
      "12. ADDITIONAL INFORMATION — where are we and where would you like to go",
    );
  });
});
