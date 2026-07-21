import { cache } from "react";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * The single settings row (id = 1), created with defaults on first read.
 *
 * Wrapped in React's `cache()` so the many call sites within one request
 * (the calendar load alone asks for it 4+ times) share a single fetch. The
 * common path is a plain read; the row is only created the very first time
 * it's missing, so steady state is a read rather than a write.
 */
export const getSettings = cache(async () => {
  const existing = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
});
