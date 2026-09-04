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
  /**
   * A blind copy — how Phoenix gets told about a booking without a second,
   * differently-worded email being written for him. He receives the exact
   * message the client received, and the client can't see he was copied.
   */
  bcc?: string;
  /**
   * Where a reply should actually go when it isn't the same as `from` — e.g. a
   * notification sent from Phoenix's own address about someone else's enquiry,
   * where hitting reply should reach that person, not Phoenix himself.
   */
  replyTo?: string;
  subject: string;
  body: string;
  /**
   * The same message as HTML — sent alongside `body`, never instead of it, so
   * a link (a client's booking page, say) can read as "Click here for your
   * booking page" rather than the raw token-bearing URL, in any inbox that
   * renders HTML. Text-only clients still get the identical plain-text mail.
   */
  html?: string;
  inReplyTo?: string;
  attachments?: Attachment[];
}

/** A random suffix makes it certain the boundary can't appear inside a part's own content. */
const randomBoundary = (label: string) => `cstl-${label}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Wrap `parts` (each already a full `Content-Type: ...\r\n\r\n<content>` block) in a multipart envelope. */
function multipart(kind: "alternative" | "mixed", parts: string[]): { contentType: string; content: string } {
  const boundary = randomBoundary(kind);
  return {
    contentType: `multipart/${kind}; boundary="${boundary}"`,
    content: parts.map((p) => `--${boundary}\r\n${p}`).join("\r\n") + `\r\n--${boundary}--`,
  };
}

const textPlainPart = (body: string) =>
  [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body).toString("base64")),
  ].join("\r\n");

const textHtmlPart = (html: string) =>
  [
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(html).toString("base64")),
  ].join("\r\n");

/**
 * Build the full message source.
 *
 * With no attachments and no `html`, this is a plain text/plain message, byte
 * for byte what it always was — the personal, unstyled email this practice
 * sends. Adding `html` wraps the text in multipart/alternative so an
 * HTML-capable inbox shows the nicer version while a text-only client still
 * gets the identical plain text. Attachments add a further multipart/mixed
 * layer around whichever of those it is, so the photo rides along either way.
 */
export function buildMessage({
  to,
  from,
  fromName = "Phoenix Tanner",
  bcc,
  replyTo,
  subject,
  body,
  html,
  inReplyTo,
  attachments = [],
}: MessageParts): string {
  const headers = [
    `To: ${to}`,
    ...(from ? [`From: ${encodeHeader(fromName)} <${from}>`] : []),
    // Gmail strips this header before delivery to `to`, and delivers a copy to
    // the address named here — which is the whole point.
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "MIME-Version: 1.0",
  ];

  // The body as one part-block, on its own (text/plain) or paired with the
  // HTML version (multipart/alternative) — either way, something attachments
  // can be appended alongside without caring which it is.
  const bodyBlock: { contentType: string; content: string } = html
    ? multipart("alternative", [textPlainPart(body), textHtmlPart(html)])
    : { contentType: 'text/plain; charset="UTF-8"', content: wrapBase64(Buffer.from(body).toString("base64")) };

  if (!attachments.length) {
    const encoding = html ? [] : ["Content-Transfer-Encoding: base64"];
    return [...headers, `Content-Type: ${bodyBlock.contentType}`, ...encoding, "", bodyBlock.content].join("\r\n");
  }

  const bodyPart = html
    ? [`Content-Type: ${bodyBlock.contentType}`, "", bodyBlock.content].join("\r\n")
    : [`Content-Type: ${bodyBlock.contentType}`, "Content-Transfer-Encoding: base64", "", bodyBlock.content].join("\r\n");

  const { contentType, content } = multipart("mixed", [
    bodyPart,
    ...attachments.map((a) =>
      [
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        `Content-Disposition: ${a.inline ? "inline" : "attachment"}; filename="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(a.base64),
      ].join("\r\n"),
    ),
  ]);

  return [...headers, `Content-Type: ${contentType}`, "", content].join("\r\n");
}
