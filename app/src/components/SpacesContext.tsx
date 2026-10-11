"use client";

import { createContext, useContext } from "react";
import { activeSpaces, EVENT_COLORS, spaceById, type Space } from "@/lib/spaces";

/**
 * Your spaces, available to every screen without passing them down by hand.
 *
 * Provided once by the dashboard layout (and by each public page that needs
 * them), with photos stripped — an entrance photo is a large data: URL that
 * only the booking page and the confirmation email ever show, so it isn't
 * shipped to every screen. See `forClient` below.
 */
const SpacesCtx = createContext<Space[]>([]);

export function SpacesProvider({ spaces, children }: { spaces: Space[]; children: React.ReactNode }) {
  return <SpacesCtx.Provider value={spaces}>{children}</SpacesCtx.Provider>;
}

/** Every space, in your order — archived ones included (for history). */
export function useSpaces(): Space[] {
  return useContext(SpacesCtx);
}

/** The spaces open for booking. */
export function useActiveSpaces(): Space[] {
  return activeSpaces(useContext(SpacesCtx));
}

/** One space by id — a stand-in named after the id if it's gone. */
export function useSpace(id: string | null | undefined): Space {
  return spaceById(useContext(SpacesCtx), id);
}

/** Chip colours for a space, from its Google Calendar colour: text in the colour, a soft tint behind. */
export function spaceChipStyle(space: Pick<Space, "eventColor">): { color: string; bg: string } {
  const hex = EVENT_COLORS[space.eventColor]?.hex ?? "#616161";
  return { color: `color-mix(in oklab, ${hex} 70%, black)`, bg: `color-mix(in oklab, ${hex} 14%, white)` };
}
