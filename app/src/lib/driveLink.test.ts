import { describe, expect, it } from "vitest";
import { parseDriveDocLink, parseDriveFolderLink } from "./driveLink";

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

describe("parseDriveDocLink", () => {
  it("reads a standard Google Doc link", () => {
    expect(parseDriveDocLink("https://docs.google.com/document/d/1AbC_dEf-GhIjKlMnOpQ/edit?tab=t.0")).toBe(
      "1AbC_dEf-GhIjKlMnOpQ",
    );
  });

  it("reads a drive file link", () => {
    expect(parseDriveDocLink("https://drive.google.com/file/d/1AbC_dEf-GhIjKlMnOpQ/view?usp=sharing")).toBe(
      "1AbC_dEf-GhIjKlMnOpQ",
    );
  });

  it("reads an open?id= link", () => {
    expect(parseDriveDocLink("https://drive.google.com/open?id=1AbC_dEf-GhIjKlMnOpQ")).toBe(
      "1AbC_dEf-GhIjKlMnOpQ",
    );
  });

  it("passes a bare id through", () => {
    expect(parseDriveDocLink("  1AbC_dEf-GhIjKlMnOpQ  ")).toBe("1AbC_dEf-GhIjKlMnOpQ");
  });

  it("rejects a folder link — a folder is not a Doc", () => {
    expect(parseDriveDocLink("https://drive.google.com/drive/folders/1AbC_dEf-GhIjKlMnOpQ")).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseDriveDocLink("")).toBeNull();
    expect(parseDriveDocLink("not a link")).toBeNull();
  });
});
