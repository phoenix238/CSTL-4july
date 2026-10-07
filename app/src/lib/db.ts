import { cache } from "react";
import { Prisma, PrismaClient } from "@prisma/client";
import { resolveSpaces, type Space } from "@/lib/spaces";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Neon's free-tier compute suspends after idle; the first connection after a
// wake-up can take longer than Prisma's default 5s connect_timeout.
function withConnectTimeout(url: string): string {
  if (!url || /[?&]connect_timeout=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "connect_timeout=15";
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasourceUrl: withConnectTimeout(process.env.DATABASE_URL ?? "") });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * The single settings row (id = 1), created with defaults on first read.
 *
 * Wrapped in React's `cache()` so the many call sites within one request
 * (the calendar load alone asks for it 4+ times) share a single fetch. The
 * common path is a plain read; the row is only created the very first time
 * it's missing, so steady state is a read rather than a write.
 *
 * Retries once on PrismaClientInitializationError — a Neon cold-start wake-up
 * that's still slower than the connect_timeout above shows up as this error
 * on the first query of a request, but the retry lands after the compute is
 * already awake.
 */
export const getSettings = cache(async () => {
  const read = () => prisma.appSettings.findUnique({ where: { id: 1 } });
  let existing;
  try {
    existing = await read();
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientInitializationError)) throw err;
    existing = await read();
  }
  if (existing) return existing;
  return prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
});

/** Every space you work from, in your order (see lib/spaces.ts). One read per request. */
export const getSpaces = cache(async (): Promise<Space[]> => resolveSpaces(await getSettings()));

/**
 * True when `id` names one of your spaces that's open for booking — the check
 * every route makes on a space id that came in from a request, so a stale tab
 * or a hand-made request can't book, browse or set hours at a space that
 * doesn't exist or has been archived.
 */
export async function isOpenSpace(id: unknown): Promise<boolean> {
  return typeof id === "string" && (await getSpaces()).some((s) => s.id === id && s.active);
}
