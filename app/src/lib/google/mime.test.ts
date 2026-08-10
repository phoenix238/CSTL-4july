import { describe, expect, it } from "vitest";
import { buildMessage, parseDataUrl } from "./mime";

// A 1x1 JPEG is enough — what's under test is the envelope, not the pixels.
const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z";

const base = { to: "sarah@example.com", from: "phoenix@example.com", subject: "Your session", body: "Hi Sarah,\n\nSee you soon." };

describe("parseDataUrl", () => {
  it("splits a browser data: URL into mime type and payload", () => {
    expect(parseDataUrl(`data:image/jpeg;base64,${TINY_JPEG_B64}`)).toEqual({
      mimeType: "image/jpeg",
      base64: TINY_JPEG_B64,
    });
  });

  it("returns null for anything that isn't one — an empty setting must not become an attachment", () => {
    expect(parseDataUrl("")).toBeNull();
    expect(parseDataUrl("https://example.com/door.jpg")).toBeNull();
    expect(parseDataUrl("data:image/jpeg,notbase64")).toBeNull();
  });
});

describe("buildMessage", () => {
  it("stays a plain text/plain message when there's nothing attached", () => {
    const msg = buildMessage(base);
    expect(msg).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(msg).not.toContain("multipart");
    // The body survives a round trip.
    const encoded = msg.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "");
    expect(Buffer.from(encoded, "base64").toString()).toBe(base.body);
  });

  it("becomes multipart with the text first and the photo inline after it", () => {
    const msg = buildMessage({
      ...base,
      attachments: [
        { filename: "bethnal-green-entrance.jpg", mimeType: "image/jpeg", base64: TINY_JPEG_B64, inline: true },
      ],
    });
    const boundary = /boundary="([^"]+)"/.exec(msg)?.[1];
    expect(boundary).toBeTruthy();
    expect(msg).toContain("Content-Type: multipart/mixed;");
    // Text part comes before the image part.
    expect(msg.indexOf("text/plain")).toBeLessThan(msg.indexOf("image/jpeg"));
    expect(msg).toContain('Content-Disposition: inline; filename="bethnal-green-entrance.jpg"');
    // Correctly terminated: opening boundary per part, and a closing one.
    expect(msg.split(`--${boundary}`).length - 1).toBe(3); // 2 parts + the terminator
    expect(msg.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("marks a non-inline attachment as a normal attachment", () => {
    const msg = buildMessage({
      ...base,
      attachments: [{ filename: "receipt.pdf", mimeType: "application/pdf", base64: "AAAA" }],
    });
    expect(msg).toContain('Content-Disposition: attachment; filename="receipt.pdf"');
  });

  it("wraps encoded lines at 76 characters, as MIME requires", () => {
    const msg = buildMessage({
      ...base,
      attachments: [{ filename: "door.jpg", mimeType: "image/jpeg", base64: TINY_JPEG_B64, inline: true }],
    });
    for (const line of msg.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    // The image payload specifically is wrapped, not one enormous line.
    expect(msg).toContain(TINY_JPEG_B64.slice(0, 76) + "\r\n");
  });

  it("encodes a non-ASCII subject so it doesn't arrive as mojibake", () => {
    const msg = buildMessage({ ...base, subject: "Your session — Bethnal Green" });
    expect(msg).toContain(`Subject: =?UTF-8?B?${Buffer.from("Your session — Bethnal Green").toString("base64")}?=`);
  });

  it("threads a reply when given a message id", () => {
    const msg = buildMessage({ ...base, inReplyTo: "<abc@mail.gmail.com>" });
    expect(msg).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(msg).toContain("References: <abc@mail.gmail.com>");
  });
});
