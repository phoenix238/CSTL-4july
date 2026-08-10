import { cache } from "react";
import { Prisma, PrismaClient } from "@prisma/client";

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
