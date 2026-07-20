/** Loose but sane email check — good enough to catch typos before we try to send to it. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
