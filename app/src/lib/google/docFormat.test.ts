import { describe, it, expect } from "vitest";
import { renderSections, type DocSection, type Rendered, type Span } from "./docFormat";

/** What a span actually points at — the whole point is that these line up. */
const at = (r: Rendered, s: Span) => r.text.slice(s.start, s.end);

const section = (over: Partial<DocSection> = {}): DocSection => ({
  heading: "2. PRESENTING ISSUE",
  lines: [],
  ...over,
});

describe("renderSections — style spans line up with the text", () => {
  it("points every bold span at the label it belongs to", () => {
    const r = renderSections([
      section({
        lines: [
          { kind: "field", label: "Name", value: "Jane Doe" },
          { kind: "paragraph", label: "Note", value: "Sacrum eased." },
          { kind: "bullets", label: "Summary", items: ["stillpoint", "unwinding"] },
        ],
      }),
    ]);

    expect(r.bold.map((s) => at(r, s))).toEqual(["Name:", "Note:", "Summary:"]);
  });

  it("covers the trailing newline on headings, so the style can't bleed downwards", () => {
    const r = renderSections([section({ lines: [{ kind: "field", label: "Name", value: "Jane" }] })]);

    const [heading] = r.headings;
    expect(at(r, heading)).toBe("2. PRESENTING ISSUE\n");
    expect(heading.style).toBe("HEADING_2");
    // The line after the heading keeps its own, normal styling.
    expect(r.text.slice(heading.end)).toMatch(/^Name: Jane/);
  });

  it("gives the title, subheadings and section headings their own outline levels", () => {
    const r = renderSections(
      [section({ heading: "1. INTAKE FORM", lines: [{ kind: "subheading", value: "1.1 Client details" }] })],
      { title: { text: "CASE HISTORY — Jane Doe", subtitle: "updated today" } },
    );

    expect(r.headings.map((h) => [h.style, at(r, h)])).toEqual([
      ["TITLE", "CASE HISTORY — Jane Doe\n"],
      ["HEADING_2", "1. INTAKE FORM\n"],
      ["HEADING_3", "1.1 Client details\n"],
    ]);
  });

  it("greys and italicises the subtitle and hints, and nothing else", () => {
    const r = renderSections([section({ lines: [{ kind: "hint", value: "What they came with." }] })], {
      title: { text: "CASE HISTORY — Jane Doe", subtitle: "CSTL · updated today" },
    });

    expect(r.italic.map((s) => at(r, s))).toEqual(["CSTL · updated today", "What they came with."]);
    expect(r.muted).toEqual(r.italic);
  });

  it("keeps spans accurate once several sections have shifted the offsets along", () => {
    const r = renderSections([
      section({ heading: "A", lines: [{ kind: "field", label: "One", value: "1" }] }),
      section({ heading: "B", lines: [{ kind: "field", label: "Two", value: "2" }] }),
      section({ heading: "C", lines: [{ kind: "field", label: "Three", value: "3" }] }),
    ]);

    expect(r.bold.map((s) => at(r, s))).toEqual(["One:", "Two:", "Three:"]);
    expect(r.headings.map((s) => at(r, s))).toEqual(["A\n", "B\n", "C\n"]);
    // Nothing may point past the end of the text it was measured against.
    for (const s of [...r.bold, ...r.italic, ...r.headings]) {
      expect(s.end).toBeLessThanOrEqual(r.text.length);
    }
  });
});

describe("renderSections — content", () => {
  it("writes an em dash for a field with nothing in it", () => {
    const r = renderSections([section({ lines: [{ kind: "field", label: "Phone", value: "" }] })]);
    expect(r.text).toContain("Phone: —");
  });

  it("leaves verbatim text alone apart from collapsing runs of blank lines", () => {
    const r = renderSections([
      section({ lines: [{ kind: "verbatim", value: "  first\n\n\n\nsecond — their words  " }] }),
    ]);
    expect(r.text).toContain("first\n\nsecond — their words");
  });

  it("starts with a blank line when appending, and without one when rebuilding", () => {
    const lines: DocSection[] = [section()];
    expect(renderSections(lines).text.startsWith("\n")).toBe(true);
    expect(renderSections(lines, { leadingNewline: false }).text.startsWith("2.")).toBe(true);
  });

  it("renders a bullet list one line per item", () => {
    const r = renderSections([section({ lines: [{ kind: "bullets", items: ["one", "two"] }] })]);
    expect(r.text).toContain("• one\n• two\n");
  });
});
