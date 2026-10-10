/**
 * The one-line result of a bank scan, shown by both scan buttons (Home and
 * Settings › Payments). Pure, so it can be shared with client components.
 */
export interface SyncCounts {
  newCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  /** Earlier, unplaced payments that this scan could finally place. */
  rematchedCount?: number;
}

export function describeSync(s: SyncCounts): string {
  const late = s.rematchedCount ?? 0;
  const lateText = `${late} earlier payment${late === 1 ? "" : "s"} now matched`;
  if (s.newCount === 0) return late ? `No new payments · ${lateText}` : "No new payments since last time";
  const parts = [`${s.newCount} new`, `${s.matchedCount} matched`, `${s.unmatchedCount + s.ambiguousCount} need a look`];
  if (late) parts.push(lateText);
  return parts.join(" · ");
}
