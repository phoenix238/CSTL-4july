import { describe, expect, it } from "vitest";
import { extractTextFromFile } from "./extractText";

describe("extractTextFromFile", () => {
  it("reads plain text formats", async () => {
    expect(await extractTextFromFile("notes.txt", Buffer.from("hello"))).toBe("hello");
    expect(await extractTextFromFile("list.CSV", Buffer.from("a,b"))).toBe("a,b");
    expect(await extractTextFromFile("readme.md", Buffer.from("# hi"))).toBe("# hi");
  });

  it("returns null for unknown formats (legacy .doc, images)", async () => {
    expect(await extractTextFromFile("old.doc", Buffer.from("x"))).toBeNull();
    expect(await extractTextFromFile("scan.jpg", Buffer.from("x"))).toBeNull();
  });

  it("returns null instead of throwing on a corrupt docx", async () => {
    expect(await extractTextFromFile("broken.docx", Buffer.from("not a zip"))).toBeNull();
  });

  it("returns null instead of throwing on a corrupt pdf", async () => {
    expect(await extractTextFromFile("broken.pdf", Buffer.from("not a pdf"))).toBeNull();
  });
});
