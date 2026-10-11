import { describe, it, expect } from "vitest";
import {
  activeSpaces,
  blankSpace,
  dayBlockSpace,
  legacySpaces,
  resolveSpaces,
  spaceBookingLabel,
  spaceById,
  spaceDefaultAmountPence,
  spaceIdFrom,
  spacePriceLabel,
  validateSpaces,
} from "./spaces";

describe("an install that has never saved its spaces (Phoenix's today)", () => {
  const settings = {
    waterlooAddress: "1 Waterloo Rd",
    bethnalAddress: "2 Bethnal Green Rd",
    waterlooLocationUrl: "https://maps.app.goo.gl/w",
    bethnalFindIt: "Green door, buzzer 4",
    waterlooDirections: "Lift to floor 2",
    waterlooArrivalNote: "Ring R5",
    mapsReviewUrlWaterloo: "https://g.page/w",
    mapsReviewUrlBethnal: "https://g.page/b",
    roomCalendarId: "r5@group.calendar.google.com",
    chalkFarmCalendarId: "cf@group.calendar.google.com",
    bookingBufferMinutes: 0,
    bethnalBufferMinutes: 15,
    chalkFarmBufferMinutes: 30,
    chalkFarmEdgeBufferMinutes: 15,
    chalkFarmClusterGapMinutes: 45,
    chalkFarmWeeklyCapHours: 10,
  };
  const [bethnal, waterloo] = resolveSpaces({ spaces: null, ...settings });

  it("reads exactly the two original clinics, under the ids existing bookings store", () => {
    expect(resolveSpaces({ spaces: null, ...settings }).map((s) => s.id)).toEqual(["bethnal", "waterloo"]);
    expect(waterloo.name).toBe("Waterloo");
    expect(bethnal.name).toBe("Bethnal Green");
  });

  it("keeps the old prices and booking-page labels word for word", () => {
    expect(spacePriceLabel(waterloo)).toBe("£80");
    expect(spacePriceLabel(bethnal)).toBe("£30–60 sliding scale");
    expect(spaceBookingLabel(waterloo)).toBe("Waterloo");
    expect(spaceBookingLabel(bethnal)).toBe("Low cost Bethnal Green");
    expect(spaceDefaultAmountPence(waterloo)).toBe(8000);
    expect(spaceDefaultAmountPence(bethnal)).toBeNull();
  });

  it("carries every per-clinic setting across", () => {
    expect(waterloo).toMatchObject({
      address: "1 Waterloo Rd",
      mapUrl: "https://maps.app.goo.gl/w",
      // the old directions/arrival pair, merged, since the new field is empty
      findIt: "Lift to floor 2\nRing R5",
      reviewUrl: "https://g.page/w",
      venueMode: "room",
      venueCalendarId: "r5@group.calendar.google.com",
      venueEventTitle: "R5 - Phoenix",
      bufferMinutes: 0,
      eventColor: "6",
    });
    expect(bethnal).toMatchObject({
      findIt: "Green door, buzzer 4",
      reviewUrl: "https://g.page/b",
      venueMode: "dayBlock",
      venueCalendarId: "cf@group.calendar.google.com",
      venueEventTitle: "Phoenix",
      venueBufferMinutes: 30,
      venueEdgeMinutes: 15,
      venueClusterGapMinutes: 45,
      weeklyCapHours: 10,
      bufferMinutes: 15,
      eventColor: "4",
    });
  });

  it("finds the one day-block space only once its venue calendar is set", () => {
    expect(dayBlockSpace([waterloo, bethnal])?.id).toBe("bethnal");
    expect(dayBlockSpace(legacySpaces({}))).toBeUndefined();
  });
});

describe("a practitioner's own saved spaces", () => {
  const saved = [
    { ...blankSpace("garden-room", "Garden Room"), pricePence: 6500 },
    { ...blankSpace("studio", "Studio"), priceKind: "sliding", priceMinPence: 2500, priceMaxPence: 5550, active: false },
  ];

  it("replace the original clinics entirely", () => {
    const spaces = resolveSpaces({ spaces: saved, waterlooAddress: "ignored" });
    expect(spaces.map((s) => s.id)).toEqual(["garden-room", "studio"]);
  });

  it("price themselves from what's entered", () => {
    const [garden, studio] = resolveSpaces({ spaces: saved });
    expect(spacePriceLabel(garden)).toBe("£65");
    expect(spacePriceLabel(studio)).toBe("£25–55.50 sliding scale");
    expect(spacePriceLabel({ ...garden, priceLabel: "£65, pay on the day" })).toBe("£65, pay on the day");
  });

  it("leave archived spaces out of booking but keep them readable", () => {
    const spaces = resolveSpaces({ spaces: saved });
    expect(activeSpaces(spaces).map((s) => s.id)).toEqual(["garden-room"]);
    expect(spaceById(spaces, "studio").name).toBe("Studio");
  });

  it("are cleaned on the way in — bad types defaulted, duplicates and id-less entries dropped", () => {
    const spaces = resolveSpaces({
      spaces: [
        { id: "a", name: "A", bufferMinutes: "lots", venueMode: "teleport", eventColor: "99" },
        { id: "a", name: "Duplicate" },
        { name: "No id" },
        null,
      ],
    });
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({ id: "a", name: "A", bufferMinutes: 15, venueMode: "none", eventColor: "7" });
  });
});

describe("spaceById", () => {
  it("still names a session at a space that has since been deleted", () => {
    const gone = spaceById(legacySpaces({}), "old-room");
    expect(gone.name).toBe("old-room");
    expect(gone.active).toBe(false);
  });
});

describe("spaceIdFrom", () => {
  it("makes a readable id that's unique among the taken ones", () => {
    expect(spaceIdFrom("The Garden Room", [])).toBe("the-garden-room");
    expect(spaceIdFrom("The Garden Room", ["the-garden-room"])).toBe("the-garden-room-2");
    expect(spaceIdFrom("!!!", [])).toBe("space");
  });
});

describe("validateSpaces", () => {
  it("accepts a sensible list", () => {
    expect(validateSpaces(legacySpaces({}))).toEqual([]);
  });

  it("needs at least one space open for booking", () => {
    expect(validateSpaces([{ ...blankSpace("a", "A"), active: false }])).toContain(
      "Keep at least one space open for booking.",
    );
  });

  it("catches an unnamed space, an upside-down scale and two day blocks", () => {
    const errors = validateSpaces([
      blankSpace("a", ""),
      { ...blankSpace("b", "B"), priceKind: "sliding", priceMinPence: 5000, priceMaxPence: 3000 },
      { ...blankSpace("c", "C"), venueMode: "dayBlock" },
      { ...blankSpace("d", "D"), venueMode: "dayBlock" },
    ]);
    expect(errors).toContain("Every space needs a name.");
    expect(errors.some((e) => e.includes("sliding scale"))).toBe(true);
    expect(errors).toContain("Only one space can use a shared day block on a venue calendar.");
  });
});
