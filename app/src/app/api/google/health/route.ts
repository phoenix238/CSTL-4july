import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { checkGoogleHealth } from "@/lib/google/health";

/**
 * "Is Google actually working?" — asked for real, on demand.
 *
 * Refreshes the token and calls Gmail rather than reading a flag, so the answer
 * reflects what the next email will do rather than what was true whenever the
 * account was first linked.
 */
export const GET = guarded(async () => NextResponse.json(await checkGoogleHealth()));
