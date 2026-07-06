import { describe, expect, it } from "vitest";
import { parseDriveFolderLink } from "./driveLink";

describe("parseDriveFolderLink", () => {
  it("reads a standard folder link", () => {
    expect(
      parseDriveFolderLink("https://drive.google.com/drive/folders/1AbC_dEf-GhIjKlMnOpQ?usp=sharing"),
    ).toBe("1AbC_dEf-GhIjKlMnOpQ");
  });

  it("reads an open?id= link", () => {
    expect(parseDriveFolderLink("https://drive.google.com/open?id=1AbC_dEf-GhIjKlMnOpQ")).toBe(
      "1AbC_dEf-GhIjKlMnOpQ",
    );
  });

  it("passes a bare id through", () => {
    expect(parseDriveFolderLink("  1AbC_dEf-GhIjKlMnOpQ  ")).toBe("1AbC_dEf-GhIjKlMnOpQ");
  });

  it("rejects junk", () => {
    expect(parseDriveFolderLink("")).toBeNull();
    expect(parseDriveFolderLink("not a link")).toBeNull();
    expect(parseDriveFolderLink("https://example.com/folders/x")).toBeNull();
  });
});
