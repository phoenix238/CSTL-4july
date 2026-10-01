/**
 * Starling Bank — the feed that tells us a session has been paid for.
 *
 * CSTL talks to Starling directly rather than going through Honey's Worker. That
 * Worker maps a transaction's description to `counterPartyName || reference`, so
 * for an incoming transfer the payer's name wins and the reference — the only
 * thing that identifies *which client* paid — is discarded before it ever
 * reaches a caller. Reading the feed ourselves keeps the reference intact.
 *
 * Read-only throughout: a personal access token scoped to reading the account
 * feed is all this needs, and it never moves money.
 */

const STARLING_API = "https://api.starlingbank.com/api/v2";

export class StarlingNotConfiguredError extends Error {
  constructor() {
    super("No Starling token is set — add STARLING_TOKEN to the environment to switch payment matching on.");
    this.name = "StarlingNotConfiguredError";
  }
}

function token(): string {
  const t = process.env.STARLING_TOKEN?.trim();
  if (!t) throw new StarlingNotConfiguredError();
  return t;
}

export function isStarlingConfigured(): boolean {
  return Boolean(process.env.STARLING_TOKEN?.trim());
}

async function starlingGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STARLING_API}${path}`, {
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Trimmed: Starling echoes request detail in errors and this can reach a log.
    throw new Error(`Starling returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface StarlingAccount {
  accountUid: string;
  defaultCategory: string;
  name: string;
}

/**
 * Every account on the token. Honey reads all of them; reading only the first
 * meant a client paying into a second account was never seen here at all.
 */
export async function getStarlingAccounts(): Promise<Array<{ accountUid: string; categoryUid: string; name: string }>> {
  const data = await starlingGet<{ accounts: StarlingAccount[] }>("/accounts");
  const accounts = (data.accounts ?? []).map((a) => ({ accountUid: a.accountUid, categoryUid: a.defaultCategory, name: a.name }));
  if (!accounts.length) throw new Error("That Starling token doesn't have access to any accounts.");
  return accounts;
}

export interface BankPayment {
  /** Starling's own id for the transaction — our idempotency key. */
  feedItemUid: string;
  transactedAt: Date;
  amountPence: number;
  /** What the payer typed as the reference. The whole point of reading directly. */
  reference: string;
  counterParty: string;
}

interface FeedItem {
  feedItemUid: string;
  amount?: { minorUnits?: number };
  direction?: string;
  reference?: string;
  counterPartyName?: string;
  transactionTime?: string;
  status?: string;
  /** Starling's own source, e.g. FASTER_PAYMENTS_IN, INTERNAL_TRANSFER. */
  source?: string;
}

/**
 * A session payment is never anywhere near this much, so anything bigger is
 * something else (rent, a transfer, other income) and only clutters the queue.
 */
export const MAX_SESSION_PAYMENT_PENCE = 10_000;

/** Is this feed item plausibly a client paying for a session? */
export function isSessionPayment(i: FeedItem): boolean {
  const pence = Math.round(i.amount?.minorUnits ?? 0);
  return (
    i.status === "SETTLED" &&
    i.direction === "IN" &&
    // Moving money between your own Starling Spaces/accounts isn't a client.
    i.source !== "INTERNAL_TRANSFER" &&
    pence > 0 &&
    pence <= MAX_SESSION_PAYMENT_PENCE
  );
}

/**
 * Settled money *in* that could be a session payment (see isSessionPayment),
 * across every account on the token, since a given moment.
 *
 * Pending transactions are skipped deliberately — one can still be reversed, and
 * marking a client paid off a payment that later vanishes is worse than being a
 * few hours late.
 */
export async function fetchIncomingPayments(since: Date): Promise<BankPayment[]> {
  const accounts = await getStarlingAccounts();
  const min = since.toISOString();
  const max = new Date().toISOString();
  const out: BankPayment[] = [];
  const seen = new Set<string>();
  for (const { accountUid, categoryUid } of accounts) {
    const data = await starlingGet<{ feedItems?: FeedItem[] }>(
      `/feed/account/${accountUid}/category/${categoryUid}/transactions-between` +
        `?minTransactionTimestamp=${encodeURIComponent(min)}&maxTransactionTimestamp=${encodeURIComponent(max)}`,
    );
    for (const i of (data.feedItems ?? []).filter(isSessionPayment)) {
      if (!i.feedItemUid || seen.has(i.feedItemUid)) continue;
      seen.add(i.feedItemUid);
      out.push({
        feedItemUid: i.feedItemUid,
        transactedAt: i.transactionTime ? new Date(i.transactionTime) : new Date(),
        amountPence: Math.round(i.amount?.minorUnits ?? 0),
        reference: (i.reference ?? "").trim(),
        counterParty: (i.counterPartyName ?? "").trim(),
      });
    }
  }
  return out;
}
