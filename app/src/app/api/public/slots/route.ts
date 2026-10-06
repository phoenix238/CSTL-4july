import { NextResponse } from "next/server";
import type { Clinic } from "@/lib/booking/rules";
import { defaultSlotWindow, loadAvailableSlots } from "@/lib/booking/slots";

// NOT guarded — public read of bookable times only. Never returns busy-span
// titles or client names (computeAvailableSlots only ever sees start/end).
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const clinic = params.get("clinic");
    if (clinic !== "waterloo" && clinic !== "bethnal") {
      return NextResponse.json({ error: "Invalid clinic" }, { status: 400 });
    }

    const { windowStart, windowEnd } = await defaultSlotWindow();
    const slots = await loadAvailableSlots({ clinic: clinic as Clinic, windowStart, windowEnd });

    // Cached at Vercel's edge for 30s (then served stale for up to 2 minutes
    // while it refreshes), so most visitors skip the Google Calendar lookup
    // that makes this route slow. Safe: booking re-verifies the real slot
    // server-side (assertSlotAvailable), so a stale list can only ever lead to
    // "that time isn't available anymore", never a double booking.
    return NextResponse.json(
      { slots: slots.map((d) => d.toISOString()) },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't load availability" }, { status: 500 });
  }
}
