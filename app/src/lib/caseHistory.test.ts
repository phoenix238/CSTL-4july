import { describe, it, expect } from "vitest";
import {
  applyExtract,
  buildCaseHistoryDoc,
  CASE_HISTORY_TITLE_PREFIX,
  hasNarrative,
  isOnLayout,
  NARRATIVE_KEYS,
  ORIGINAL_RECORD_HEADING,
  originalRecordFrom,
  resolveCaseHistory,
  resolveIntakeSnapshot,
  seedFromIntake,
  SESSION_LOG_HEADING,
  type CaseHistoryInput,
  type IntakeSnapshot,
} from "./caseHistory";
import { renderSections } from "./google/docFormat";

const SUBMITTED = new Date("2026-07-04T10:00:00Z");

const snapshot = (over: Partial<IntakeSnapshot> = {}): IntakeSnapshot => ({
  items: [
    { label: "Full name", value: "Jane Doe", group: "details" },
    { label: "Occupation", value: "Nurse — long shifts on her feet", group: "details" },
    { label: "Any medications you take", value: "Sertraline 50mg", group: "health" },
    { label: "Health conditions / injuries I should know about", value: "Hypermobility", group: "health" },
    {
      label: "What brings you to therapy — anything you'd like me to know",
      value: "Neck pain since a car accident, and I can't switch off.",
      group: "caseHistory",
    },
  ],
  consent: true,
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
    history: {},
    intake: { snapshot: null, submittedAt: null },
    sessions: [],
    firstSeen: null,
    sessionCount: 0,
    ...over,
  };
}

/** The headings a built Doc actually carries, in the order they appear. */
const headingsOf = (built: ReturnType<typeof buildCaseHistoryDoc>) => built.sections.map((s) => s.heading);

describe("the layout", () => {
  it("has every header, numbered, in the standard order", () => {
    const headings = headingsOf(buildCaseHistoryDoc(input()));

    expect(headings).toEqual([
      "AT A GLANCE",
      "1. INTAKE FORM — not yet returned",
      "2. PRESENTING ISSUE",
      "3. HISTORY OF PRESENTING ISSUE",
      "4. MEDICAL HISTORY",
      "5. MEDICATIONS & SUPPLEMENTS",
      "6. PREVIOUS TREATMENT / THERAPIES",
      "7. LIFESTYLE, WORK & STRESSORS",
      "8. BIRTH & DEVELOPMENTAL HISTORY",
      "9. INJURIES, ACCIDENTS & SURGERY",
      "10. RED FLAGS / CAUTIONS",
      "11. GOALS — WHAT THEY WANT FROM THE WORK",
      "12. TREATMENT PLAN",
      SESSION_LOG_HEADING,
      "14. CONSENT & DATA",
    ]);
  });

  it("puts the intake form at the top, above the clinical sections", () => {
    const headings = headingsOf(
      buildCaseHistoryDoc(input({ intake: { snapshot: snapshot(), submittedAt: SUBMITTED } })),
    );

    const intakeAt = headings.findIndex((h) => h.startsWith("1. INTAKE FORM"));
    const presentingAt = headings.findIndex((h) => h.startsWith("2. PRESENTING"));
    expect(intakeAt).toBe(1); // straight after AT A GLANCE
    expect(intakeAt).toBeLessThan(presentingAt);
  });

  it("titles the Doc for the client and dates the intake it holds", () => {
    const built = buildCaseHistoryDoc(input({ intake: { snapshot: snapshot(), submittedAt: SUBMITTED } }));

    expect(built.title.text).toBe(`${CASE_HISTORY_TITLE_PREFIX}Jane Doe`);
    expect(headingsOf(built)[1]).toBe("1. INTAKE FORM — submitted 4 Jul 2026");
  });

  it("reproduces the intake answers under numbered subheadings", () => {
    const built = buildCaseHistoryDoc(input({ intake: { snapshot: snapshot(), submittedAt: SUBMITTED } }));
    const intake = built.sections[1];

    const subheadings = intake.lines.filter((l) => l.kind === "subheading").map((l) => l.value);
    expect(subheadings).toEqual([
      "1.1 Client details",
      "1.2 Health information",
      "1.3 What brings them to therapy",
      "1.5 Consent",
    ]);

    const text = renderSections([intake]).text;
    expect(text).toContain("Neck pain since a car accident");
    expect(text).toContain("Consent given: Yes");
  });

  it("prompts rather than leaving a bare header when a section is empty", () => {
    const built = buildCaseHistoryDoc(input());
    const presenting = built.sections.find((s) => s.heading.startsWith("2."))!;

    expect(presenting.lines[0].kind).toBe("hint");
  });

  it("logs sessions newest first, each its own outline entry", () => {
    const built = buildCaseHistoryDoc(
      input({
        sessions: [
          { date: new Date("2026-07-10T10:00:00Z"), clinic: "bethnal", bullets: ["stillpoint"], raw: "First." },
          { date: new Date("2026-08-01T10:00:00Z"), clinic: "waterloo", bullets: ["sacrum"], raw: "Second." },
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
      input({ history: { priorSessions: [{ date: "March 2025", text: "Worked with the occipital base." }] } }),
    );

    expect(headingsOf(built)).toContain("March 2025 · from the original record");
  });

  it("adds the original record only when there is one, and always last", () => {
    expect(headingsOf(buildCaseHistoryDoc(input()))).not.toContain(ORIGINAL_RECORD_HEADING);

    const withOriginal = headingsOf(buildCaseHistoryDoc(input({ originalRecord: "Old free-text notes." })));
    expect(withOriginal.at(-1)).toBe(ORIGINAL_RECORD_HEADING);
  });

  it("renders as a Doc that reads as being on the layout", () => {
    const built = buildCaseHistoryDoc(input());
    const text = renderSections(built.sections, { title: built.title }).text;

    expect(isOnLayout(text)).toBe(true);
  });
});

describe("the intake informing the case history", () => {
  it("seeds the sections the form already answers, and says where they came from", () => {
    const seeded = seedFromIntake({}, snapshot(), SUBMITTED);

    expect(seeded.presenting).toContain("Neck pain since a car accident");
    expect(seeded.medical).toContain("Hypermobility");
    expect(seeded.medications).toContain("Sertraline 50mg");
    expect(seeded.lifestyle).toContain("long shifts on her feet");
    expect(seeded.presenting).toContain("[From the intake form, 4 Jul 2026]");
  });

  it("leaves the sections the form says nothing about empty", () => {
    const seeded = seedFromIntake({}, snapshot(), SUBMITTED);

    expect(seeded.birthDevelopment).toBeUndefined();
    expect(seeded.plan).toBeUndefined();
  });

  it("never writes over something already recorded", () => {
    const seeded = seedFromIntake({ presenting: "Written up after our first session." }, snapshot(), SUBMITTED);

    expect(seeded.presenting).toBe("Written up after our first session.");
  });

  it("ignores an answer left blank", () => {
    const blank = snapshot({
      items: snapshot().items.map((i) => (i.group === "health" ? { ...i, value: "" } : i)),
    });

    expect(seedFromIntake({}, blank, SUBMITTED).medical).toBeUndefined();
  });
});

describe("sorting an old Doc into the sections", () => {
  const extract = {
    presenting: "Headaches most afternoons.",
    injuries: "Fell off a bike, 2019.",
    priorSessions: [{ date: "2 Feb 2025", text: "Long stillpoint at the sacrum." }],
  };

  it("fills the empty sections and reports which", () => {
    const { history, filled } = applyExtract({}, extract);

    expect(history.presenting).toBe("Headaches most afternoons.");
    expect(filled).toEqual(["2. PRESENTING ISSUE", "9. INJURIES, ACCIDENTS & SURGERY"]);
  });

  it("does not touch a section that already has something in it", () => {
    const { history, filled } = applyExtract({ presenting: "Her own words, typed up." }, extract);

    expect(history.presenting).toBe("Her own words, typed up.");
    expect(filled).toEqual(["9. INJURIES, ACCIDENTS & SURGERY"]);
  });

  it("carries recovered sessions across, but not over ones already held", () => {
    expect(applyExtract({}, extract).history.priorSessions).toHaveLength(1);

    const held = { priorSessions: [{ date: "older", text: "already recovered" }] };
    expect(applyExtract(held, extract).history.priorSessions).toEqual(held.priorSessions);
  });

  it("knows whether anything clinical has been recorded", () => {
    expect(hasNarrative({})).toBe(false);
    expect(hasNarrative({ priorSessions: [{ date: "", text: "x" }] })).toBe(false);
    expect(hasNarrative({ plan: "Fortnightly for six weeks." })).toBe(true);
  });
});

describe("keeping the old record through a rebuild", () => {
  const oldDoc = "Jane Doe\nSaw her in March, neck much freer.\nMeds: none.";

  const reformatted = (original: string) => {
    const built = buildCaseHistoryDoc(input({ originalRecord: original }));
    return renderSections(built.sections, { title: built.title }).text;
  };

  it("treats an un-reformatted Doc's whole contents as the record to keep", () => {
    expect(originalRecordFrom(oldDoc)).toBe(oldDoc);
  });

  it("ignores the placeholder text a brand-new Doc is created with", () => {
    expect(originalRecordFrom("Jane Doe — CSTL client record\nCreated 04/07/2026\n\n")).toBe("");
  });

  it("has nothing to keep from a Doc already on the layout with no original", () => {
    expect(originalRecordFrom(reformatted(""))).toBe("");
  });

  it("recovers the kept record from a Doc that has already been reformatted", () => {
    const kept = originalRecordFrom(reformatted(oldDoc));

    expect(kept).toContain("Saw her in March, neck much freer.");
    expect(kept).not.toContain(SESSION_LOG_HEADING);
    expect(kept).not.toContain(CASE_HISTORY_TITLE_PREFIX);
  });

  it("stays the same record however many times it is reformatted", () => {
    const once = originalRecordFrom(reformatted(oldDoc));
    const twice = originalRecordFrom(reformatted(once));

    expect(twice).toBe(once);
    // The record is kept once over, not nested inside itself.
    expect(twice.split("Saw her in March")).toHaveLength(2);
  });
});

describe("reading back what was stored", () => {
  it("keeps only real narrative sections", () => {
    const history = resolveCaseHistory({ presenting: " Headaches ", nonsense: "x", plan: "   " });

    expect(history).toEqual({ presenting: "Headaches" });
    expect(NARRATIVE_KEYS).toContain("presenting");
  });

  it("shrugs off junk instead of throwing", () => {
    expect(resolveCaseHistory(null)).toEqual({});
    expect(resolveCaseHistory("not an object")).toEqual({});
    expect(resolveCaseHistory({ priorSessions: [{ text: "" }, "nope", null] })).toEqual({});
    expect(resolveIntakeSnapshot({ items: [] })).toBeNull();
    expect(resolveIntakeSnapshot(undefined)).toBeNull();
  });

  it("keeps an intake snapshot's labels, values and consent", () => {
    const resolved = resolveIntakeSnapshot({
      items: [{ label: "Phone", value: "07700 900000", group: "details" }, { label: "", value: "dropped" }],
      consent: true,
    });

    expect(resolved).toEqual({
      items: [{ label: "Phone", value: "07700 900000", group: "details" }],
      consent: true,
    });
  });

  it("treats an unanswered consent question as unanswered, not as a no", () => {
    expect(resolveIntakeSnapshot({ items: [{ label: "Phone", value: "", group: "details" }] })?.consent).toBeNull();
  });
});
