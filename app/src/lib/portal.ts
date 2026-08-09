import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";

/**
 * The client portal: one permanent private link per client (/me/[token]) where
 * they book their next session, move an existing one, and see what they owe.
 *
 * Deliberately a token in the URL rather than an email-and-password login.
 * There's nothing for the client to forget, no reset flow to build, and the
 * portal stays undiscoverable — which matters while the practice isn't public.
 * The trade-off is that anyone holding the link is treated as that client, so
 * the portal only ever exposes that one person's own booking and balance, never
 * anything about anyone else and never a way to see the wider schedule.
 */

/** Ensure the client has a private portal token, creating one on first use. */
export async function getOrCreatePortalToken(clientId: string): Promise<string> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.portalToken) return client.portalToken;
  const token = randomUUID();
  await prisma.client.update({ where: { id: clientId }, data: { portalToken: token } });
  return token;
}

/** The full URL a client visits to manage their own bookings. */
export function portalUrl(settings: { appUrl?: string | null }, token: string): string {
  return `${appBaseUrl(settings)}/me/${token}`;
}

/**
 * A client's initials, for the front of their payment reference: "Jono Smith" →
 * "JS". Only there to make the reference recognisable on a bank statement — the
 * number after it is what actually guarantees uniqueness, so initials colliding
 * is fine and expected.
 *
 * A one-word name gives its first two letters ("Jono" → "JO") rather than a lone
 * letter, which reads like a typo on a statement.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.map((w) => w.toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean);
  if (!letters.length) return "CL";
  if (letters.length === 1) return letters[0].slice(0, 2).padEnd(2, "X");
  // First and last, so a middle name doesn't push the surname out.
  return letters[0][0] + letters[letters.length - 1][0];
}

/**
 * Take the next number in the shared sequence. Atomic — Postgres serialises the
 * increment, so two clients created at the same instant get different numbers.
 */
async function nextRefNumber(): Promise<number> {
  const row = await prisma.paymentRefCounter.upsert({
    where: { id: 1 },
    create: { id: 1, next: 2 },
    update: { next: { increment: 1 } },
  });
  // `next` is the value *after* the increment, so the one we just claimed is one below.
  // On the create path we wrote 2 and claimed 1, which matches.
  return row.next - 1;
}

/**
 * Ensure the client has a bank-transfer reference, creating one on first use.
 *
 * Shape is initials + a sequential number — "JS-4". The number comes from a
 * single shared counter starting at 1, so it's unique on its own; two clients
 * with the same initials simply get different numbers, and there's no collision
 * case to handle. The initials just make the reference recognisable when it
 * appears on a statement.
 *
 * Assigned once and never changed — by the time a client uses it, it's printed
 * on an email and possibly saved as a payee on their banking app.
 */
export async function getOrCreatePaymentRef(clientId: string): Promise<string> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.paymentRef) return client.paymentRef;

  const ref = `${initialsFor(client.name)}-${await nextRefNumber()}`;
  await prisma.client.update({ where: { id: clientId }, data: { paymentRef: ref } });
  return ref;
}

/** Both private links a client needs, created together when the portal link is sent. */
export async function getPortalIdentity(clientId: string) {
  const [token, paymentRef] = await Promise.all([
    getOrCreatePortalToken(clientId),
    getOrCreatePaymentRef(clientId),
  ]);
  return { token, paymentRef };
}
