import { describe, expect, it } from "vitest";
import { cleanAttribution } from "./attribution";

describe("cleanAttribution", () => {
  it("keeps the four campaign tags, lower-cased", () => {
    expect(
      cleanAttribution({
        utm_source: "Meta",
        utm_medium: "paid_social",
        utm_campaign: "bg_imagetest_sep28",
        utm_content: "DrawingA",
      }),
    ).toEqual({
      adSource: "meta",
      adMedium: "paid_social",
      adCampaign: "bg_imagetest_sep28",
      adContent: "drawinga",
    });
  });

  it("returns undefined when there is nothing usable", () => {
    expect(cleanAttribution(undefined)).toBeUndefined();
    expect(cleanAttribution("meta")).toBeUndefined();
    expect(cleanAttribution({})).toBeUndefined();
    expect(cleanAttribution({ utm_source: 42 })).toBeUndefined();
  });

  it("strips unsafe characters and caps the length", () => {
    const a = cleanAttribution({ utm_source: "<script>alert(1)</script>", utm_campaign: "x".repeat(500) });
    expect(a?.adSource).toBe("scriptalert1script");
    expect(a?.adCampaign).toHaveLength(80);
  });

  it("ignores keys that aren't campaign tags", () => {
    const a = cleanAttribution({ utm_source: "meta", email: "a@b.c", fbclid: "abc" });
    expect(a).toEqual({ adSource: "meta", adMedium: "", adCampaign: "", adContent: "" });
  });
});
