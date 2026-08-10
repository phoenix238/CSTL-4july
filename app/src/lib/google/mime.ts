// Assembling the raw RFC 5322 message Gmail's API wants. Split out from
// gmail.ts so the MIME structure — the part that's fiddly and easy to get
// subtly wrong — can be unit-tested without a Google client.

export interface Attachment {
  filename: string;
  /** e.g. "image/jpeg" */
  mimeType: string;
  /** raw bytes, base64-encoded (no data: prefix) */
  base64: string;
  /**
   * `inline` asks the mail client to show the image under the message rather
   * than as a paperclip. Gmail and Apple Mail both honour it for images, and
   * anything that doesn't just falls back to an ordinary attachment — which is
   * why this is worth doing without moving the whole email to HTML.
   */
  inline?: boolean;
}

/** A data: URL from a browser file input, split into the parts MIME needs. */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

/** RFC 2045 caps encoded lines at 76 characters. */
const wrapBase64 = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join("\r\n");

const encodeHeader = (value: string) => `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

export interface MessageParts {
  to: string;
  from?: string;
  fromName?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  attachments?: Attachment[];
}

/**
 * Build the full message source.
 *
 * With no attachments this is a plain text/plain message, byte for byte what
 * it always was — the personal, unstyled email this practice sends. Add one
 * and it becomes multipart/mixed, with the text still the first part, so the
 * message reads identically and the photo rides along.
 */
export function buildMessage({
  to,
  from,
  fromName = "Phoenix Tanner",
  subject,
  body,
  inReplyTo,
  attachments = [],
}: MessageParts): string {
  const headers = [
    `To: ${to}`,
    ...(from ? [`From: ${encodeHeader(fromName)} <${from}>`] : []),
    `Subject: ${encodeHeader(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "MIME-Version: 1.0",
  ];

  if (!attachments.length) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(Buffer.from(body).toString("base64")),
    ].join("\r\n");
  }

  // Boundary must not appear in any part. A random suffix makes that certain
  // without having to scan the payload.
  const boundary = `--cstl-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts = [
    [
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(Buffer.from(body).toString("base64")),
    ].join("\r\n"),
    ...attachments.map((a) =>
      [
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        `Content-Disposition: ${a.inline ? "inline" : "attachment"}; filename="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(a.base64),
      ].join("\r\n"),
    ),
  ];

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
  ].join("\r\n");
}
