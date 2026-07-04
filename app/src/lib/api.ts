import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/** Auth-gate a route handler and turn thrown errors into readable JSON. */
export function guarded<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse | Response>,
) {
  return async (...args: T) => {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      console.error(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
