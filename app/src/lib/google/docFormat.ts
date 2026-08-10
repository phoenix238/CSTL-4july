/**
 * Turning sections into the text of a Google Doc, plus the style spans that
 * decorate it. Pure string maths — nothing here talks to Google.
 *
 * Kept apart from drive.ts on purpose: the offsets this produces are handed
 * straight to the Docs API as index ranges, and an off-by-one silently mangles
 * a real client's record. Separate module, no I/O, unit-tested.
 */

export type DocLine =
  | { kind: "field"; label: string; value: string }
  | { kind: "subheading"; value: string }
  | { kind: "paragraph"; label?: string; value: string }
  | { kind: "bullets"; label?: string; items: string[] }
  /** Grey italic guidance shown while a case-history section is still empty. */
  | { kind: "hint"; value: string }
  /** Text reproduced exactly as it was found — no labels, no reflowing. */
  | { kind: "verbatim"; value: string };

export interface DocSection {
  heading: string;
  lines: DocLine[];
}

export interface DocTitle {
  text: string;
  subtitle?: string;
}

export interface Span {
  start: number;
  end: number;
}

export type HeadingStyle = "TITLE" | "HEADING_1" | "HEADING_2" | "HEADING_3";

export interface Rendered {
  text: string;
  bold: Span[];
  italic: Span[];
  muted: Span[];
  /** paragraph spans that become real Google Docs headings (outline entries) */
  headings: Array<Span & { style: HeadingStyle }>;
}

/**
 * Render sections to text + style spans. Every span is an offset into `text`,
 * so the caller only has to add the index it inserts at.
 *
 * Heading spans deliberately cover the trailing newline: a Docs paragraph style
 * applies to whole paragraphs, and a range stopping short of the newline would
 * bleed the heading style onto the line beneath it.
 */
export function renderSections(
  sections: DocSection[],
  opts: { title?: DocTitle | string | null; leadingNewline?: boolean } = {},
): Rendered {
  let text = opts.leadingNewline === false ? "" : "\n";
  const bold: Span[] = [];
  const italic: Span[] = [];
  const muted: Span[] = [];
  const headings: Rendered["headings"] = [];

  const title = typeof opts.title === "string" ? { text: opts.title } : opts.title;
  if (title?.text) {
    const start = text.length;
    text += `${title.text}\n`;
    headings.push({ start, end: start + title.text.length + 1, style: "TITLE" });
    if (title.subtitle) {
      const subStart = text.length;
      text += `${title.subtitle}\n`;
      italic.push({ start: subStart, end: subStart + title.subtitle.length });
      muted.push({ start: subStart, end: subStart + title.subtitle.length });
    }
    text += "\n";
  }

  const label = (labelText: string, trailing: string) => {
    const start = text.length;
    text += `${labelText}${trailing}`;
    bold.push({ start, end: start + labelText.length });
  };

  for (const section of sections) {
    const headStart = text.length;
    text += `${section.heading}\n`;
    headings.push({ start: headStart, end: headStart + section.heading.length + 1, style: "HEADING_2" });

    for (const line of section.lines) {
      if (line.kind === "field") {
        label(`${line.label}:`, ` ${line.value || "—"}\n`);
      } else if (line.kind === "subheading") {
        const start = text.length;
        text += `${line.value}\n`;
        headings.push({ start, end: start + line.value.length + 1, style: "HEADING_3" });
      } else if (line.kind === "paragraph") {
        if (line.label) label(`${line.label}:`, "\n");
        text += `${line.value?.trim() || "—"}\n\n`;
      } else if (line.kind === "bullets") {
        if (line.label) label(`${line.label}:`, "\n");
        for (const item of line.items) text += `• ${item}\n`;
        text += "\n";
      } else if (line.kind === "hint") {
        const start = text.length;
        text += `${line.value}\n\n`;
        italic.push({ start, end: start + line.value.length });
        muted.push({ start, end: start + line.value.length });
      } else if (line.kind === "verbatim") {
        text += `${line.value.replace(/\n{3,}/g, "\n\n").trim()}\n\n`;
      }
    }
    text += "\n";
  }

  return { text, bold, italic, muted, headings };
}
