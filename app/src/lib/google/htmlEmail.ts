// Turning a plain-text email body into an HTML alternative that hides a
// token-bearing URL (the client's booking page, intake form, etc.) behind a
// friendly link label instead of showing the raw address.

export interface EmailLink {
  /** the literal URL as it appears in the plain-text body */
  url: string;
  /** what the client sees instead, e.g. "Click here for your booking page" */
  label: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The plain-text body, escaped and turned into HTML, with any of `links`
 * swapped for `<a>label</a>` wherever the raw URL appears in the text. Every
 * email still sends its plain-text body too (see gmail.ts) — this is only the
 * alternative an HTML-capable inbox shows instead.
 */
export function htmlFromPlainText(body: string, links: EmailLink[] = []): string {
  let escaped = escapeHtml(body);
  for (const { url, label } of links) {
    if (!url) continue;
    const escapedUrl = escapeHtml(url);
    if (!escaped.includes(escapedUrl)) continue;
    escaped = escaped.split(escapedUrl).join(`<a href="${escapedUrl}">${escapeHtml(label)}</a>`);
  }
  const withBreaks = escaped.replace(/\n/g, "<br>\n");
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;">${withBreaks}</div>`;
}
