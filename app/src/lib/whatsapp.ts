// Build wa.me deep links so Phoenix can reply to a client in WhatsApp with the
// message pre-typed. Works on iPhone and Android (opens their existing chat).

/** Normalise a UK-ish phone number to international digits (no +, no spaces). */
export function normalizeUkPhone(raw: string): string | null {
  if (!raw) return null;
  const hasPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return digits; // already international
  if (digits.startsWith("44")) return digits;
  if (digits.startsWith("0")) return `44${digits.slice(1)}`; // 07… → 447…
  return digits; // assume already international-ish
}

/** wa.me link that opens the client's chat with `text` ready to send. */
export function waLink(phone: string, text: string): string | null {
  const num = normalizeUkPhone(phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
