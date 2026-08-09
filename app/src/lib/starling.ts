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

/** The account whose feed we read. Uses the first account on the token. */
export async function getStarlingAccount(): Promise<{ accountUid: string; categoryUid: string; name: string }> {
  const data = await starlingGet<{ accounts: StarlingAccount[] }>("/accounts");
  const account = data.accounts?.[0];
  if (!account) throw new Error("That Starling token doesn't have access to any accounts.");
  return { accountUid: account.accountUid, categoryUid: account.defaultCategory, name: account.name };
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
}

/**
 * Settled money *in*, since a given moment.
 *
 * Pending transactions are skipped deliberately — one can still be reversed, and
 * marking a client paid off a payment that later vanishes is worse than being a
 * few hours late.
 */
export async function fetchIncomingPayments(since: Date): Promise<BankPayment[]> {
  const { accountUid, categoryUid } = await getStarlingAccount();
  const min = since.toISOString();
  const max = new Date().toISOString();
  const data = await starlingGet<{ feedItems?: FeedItem[] }>(
    `/feed/account/${accountUid}/category/${categoryUid}/transactions-between` +
      `?minTransactionTimestamp=${encodeURIComponent(min)}&maxTransactionTimestamp=${encodeURIComponent(max)}`,
  );

  return (data.feedItems ?? [])
    .filter((i) => i.status === "SETTLED" && i.direction === "IN")
    .map((i) => ({
      feedItemUid: i.feedItemUid,
      transactedAt: i.transactionTime ? new Date(i.transactionTime) : new Date(),
      amountPence: Math.round(i.amount?.minorUnits ?? 0),
      reference: (i.reference ?? "").trim(),
      counterParty: (i.counterPartyName ?? "").trim(),
    }))
    .filter((p) => p.feedItemUid && p.amountPence > 0);
}
