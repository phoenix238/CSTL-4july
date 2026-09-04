import { describe, expect, it } from "vitest";
import { htmlFromPlainText } from "./htmlEmail";

describe("htmlFromPlainText", () => {
  it("turns a known URL into a labelled link, wherever it sits in the text", () => {
    const body = "Whenever you're ready, your page is here:\nhttps://app.example.com/me/9f2c-uuid-token";
    const html = htmlFromPlainText(body, [
      { url: "https://app.example.com/me/9f2c-uuid-token", label: "Click here for your booking page" },
    ]);
    expect(html).toContain('<a href="https://app.example.com/me/9f2c-uuid-token">Click here for your booking page</a>');
    expect(html).not.toContain("9f2c-uuid-token</a>&gt;"); // sanity: not double-escaped
  });

  it("leaves the text alone when the link list is empty", () => {
    const html = htmlFromPlainText("Hi there,\n\nSee you soon.");
    expect(html).not.toContain("<a ");
    expect(html).toContain("Hi there,<br>");
  });

  it("escapes HTML-sensitive characters in the body", () => {
    const html = htmlFromPlainText("Tom & Jerry <script>");
    expect(html).toContain("Tom &amp; Jerry &lt;script&gt;");
  });

  it("skips a link whose URL never appears in the body", () => {
    const html = htmlFromPlainText("Hi there,", [{ url: "https://example.com/x", label: "Click here" }]);
    expect(html).not.toContain("<a ");
  });

  it("replaces every occurrence of the same URL", () => {
    const url = "https://app.example.com/me/token";
    const body = `First: ${url}\nAgain: ${url}`;
    const html = htmlFromPlainText(body, [{ url, label: "your page" }]);
    expect(html.split("your page").length - 1).toBe(2);
  });
});
