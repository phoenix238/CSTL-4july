import { describe, it, expect } from "vitest";
import {
  chooseBookingToSettle,
  matchKnownPayer,
  matchNameAndAmount,
  matchReference,
  normaliseRef,
  suggestClientByKnownReference,
  suggestClientByName,
  type PayableBooking,
} from "./match";

const CANDIDATES = [
  { clientId: "jono", paymentRef: "JS4" },
  { clientId: "jane", paymentRef: "JS41" },
  { clientId: "anna", paymentRef: "AV12" },
];

describe("normaliseRef", () => {
  it("strips punctuation and casing", () => {
    expect(normaliseRef("js-4")).toBe("JS4");
    expect(normaliseRef(" j s 4 ")).toBe("JS4");
  });
});

describe("matchReference", () => {
  it("matches an exact reference", () => {
    expect(matchReference("JS4", CANDIDATES)).toEqual({ status: "matched", clientId: "jono" });
  });

  it("matches regardless of how the payer punctuated it", () => {
    for (const typed of ["js4", "JS-4", "js 4", " JS4 "]) {
      expect(matchReference(typed, CANDIDATES)).toEqual({ status: "matched", clientId: "jono" });
    }
  });

  it("matches a reference sitting among other words", () => {
    expect(matchReference("CSTL JS4 August", CANDIDATES)).toEqual({ status: "matched", clientId: "jono" });
  });

  it("matches a reference split by a space or dash with other words around it", () => {
    for (const typed of ["Jono JS-4", "JS 4 session", "CSTL js 4 August", "Jono Smith JS-4"]) {
      expect(matchReference(typed, CANDIDATES)).toEqual({ status: "matched", clientId: "jono" });
    }
  });

  it("rejoins a split reference as a whole number, never a shorter one", () => {
    expect(matchReference("Jane JS 41", CANDIDATES)).toEqual({ status: "matched", clientId: "jane" });
  });

  it("never lets one reference match a longer one — the whole point of the rule", () => {
    // JS4 is a substring of JS41. A contains-check would credit Jane's payment
    // to Jono the moment the counter passed ten.
    expect(matchReference("JS41", CANDIDATES)).toEqual({ status: "matched", clientId: "jane" });
  });

  it("returns none for an unrecognised reference", () => {
    expect(matchReference("SOMETHING ELSE", CANDIDATES)).toEqual({ status: "none" });
    expect(matchReference("", CANDIDATES)).toEqual({ status: "none" });
    expect(matchReference("!!!", CANDIDATES)).toEqual({ status: "none" });
  });

  it("refuses to guess when two references both fit", () => {
    const result = matchReference("JS4 AV12", CANDIDATES);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.clientIds.sort()).toEqual(["anna", "jono"]);
  });

  it("ignores a client with no reference assigned yet", () => {
    expect(matchReference("JS4", [{ clientId: "nobody", paymentRef: "" }])).toEqual({ status: "none" });
  });

  it("does not match on the sender's name", () => {
    // Names are exactly what references exist to disambiguate.
    expect(matchReference("JONO SMITH", CANDIDATES)).toEqual({ status: "none" });
  });
});

describe("suggestClientByName", () => {
  const clients = [
    { clientId: "a", name: "Jono Smith" },
    { clientId: "b", name: "Sarah Kimani" },
  ];

  it("suggests the client whose whole name is in the sender's name", () => {
    expect(suggestClientByName("MR JONO SMITH", clients)).toBe("a");
    expect(suggestClientByName("Sarah Kimani", clients)).toBe("b");
  });

  it("suggests no one on a first name alone — too weak to guess", () => {
    expect(suggestClientByName("JONO", clients)).toBeNull();
  });

  it("suggests no one when two clients both fit", () => {
    const two = [
      { clientId: "a", name: "Jono Smith" },
      { clientId: "b", name: "Jono Smith" },
    ];
    expect(suggestClientByName("JONO SMITH", two)).toBeNull();
  });

  it("suggests no one for an empty or symbol-only sender", () => {
    expect(suggestClientByName("", clients)).toBeNull();
    expect(suggestClientByName("—", clients)).toBeNull();
  });
});

describe("matchKnownPayer", () => {
  const clients = [
    { clientId: "a", knownPayerNames: ["MR P PHILLIPS"] },
    { clientId: "b", knownPayerNames: ["Sarah Kimani"] },
  ];

  it("matches a remembered payer exactly, ignoring case and punctuation", () => {
    expect(matchKnownPayer("mr p phillips", clients)).toEqual({ status: "matched", clientId: "a" });
    expect(matchKnownPayer("Sarah  Kimani", clients)).toEqual({ status: "matched", clientId: "b" });
  });

  it("does not match a name that only overlaps — remembering is exact, not fuzzy", () => {
    expect(matchKnownPayer("P PHILLIPS", clients)).toEqual({ status: "none" });
    expect(matchKnownPayer("MR P PHILLIPS JOINT ACCOUNT", clients)).toEqual({ status: "none" });
  });

  it("returns none for a sender with no remembered match", () => {
    expect(matchKnownPayer("Someone Else", clients)).toEqual({ status: "none" });
    expect(matchKnownPayer("", clients)).toEqual({ status: "none" });
  });

  it("refuses to guess when the same remembered name was somehow given to two clients", () => {
    const dup = [
      { clientId: "a", knownPayerNames: ["Jono Smith"] },
      { clientId: "b", knownPayerNames: ["Jono Smith"] },
    ];
    const result = matchKnownPayer("Jono Smith", dup);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.clientIds.sort()).toEqual(["a", "b"]);
  });

  it("ignores a client with no remembered payer yet", () => {
    expect(matchKnownPayer("Anyone", [{ clientId: "nobody", knownPayerNames: [] }])).toEqual({ status: "none" });
  });
});

describe("suggestClientByKnownReference", () => {
  const clients = [
    { clientId: "a", knownReferences: ["for my session"] },
    { clientId: "b", knownReferences: ["thanks!"] },
  ];

  it("suggests the client who typed this exact text before", () => {
    expect(suggestClientByKnownReference("FOR MY SESSION", clients)).toBe("a");
    expect(suggestClientByKnownReference("thanks !", clients)).toBe("b");
  });

  it("does not suggest on a partial repeat — exact only, like matchKnownPayer", () => {
    expect(suggestClientByKnownReference("for my session in August", clients)).toBeNull();
  });

  it("returns null for text nobody has typed before", () => {
    expect(suggestClientByKnownReference("something new", clients)).toBeNull();
    expect(suggestClientByKnownReference("", clients)).toBeNull();
  });

  it("suggests no one when two clients share a remembered reference", () => {
    const dup = [
      { clientId: "a", knownReferences: ["cash for cranio"] },
      { clientId: "b", knownReferences: ["cash for cranio"] },
    ];
    expect(suggestClientByKnownReference("cash for cranio", dup)).toBeNull();
  });
});

const NOW = new Date("2026-08-09T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function bk(over: Partial<PayableBooking> = {}): PayableBooking {
  return { id: "b", startsAt: day(-1), paid: false, amountPence: 8000, status: "confirmed", ...over };
}

describe("chooseBookingToSettle", () => {
  it("settles the oldest unpaid session within the window before the transfer", () => {
    const chosen = chooseBookingToSettle(
      [bk({ id: "recent", startsAt: day(-1) }), bk({ id: "older", startsAt: day(-6) })],
      NOW,
    );
    expect(chosen?.id).toBe("older");
  });

  it("does not settle a session older than the window — it's left for a human", () => {
    // A payment shouldn't quietly pay off a session from three weeks ago.
    const chosen = chooseBookingToSettle([bk({ id: "ancient", startsAt: day(-30) })], NOW);
    expect(chosen).toBeNull();
  });

  it("still settles an old session when the window is lifted (a hand-assignment)", () => {
    const chosen = chooseBookingToSettle([bk({ id: "ancient", startsAt: day(-30) })], NOW, Infinity);
    expect(chosen?.id).toBe("ancient");
  });

  it("skips sessions already paid", () => {
    const chosen = chooseBookingToSettle(
      [bk({ id: "old", startsAt: day(-6), paid: true }), bk({ id: "recent", startsAt: day(-1) })],
      NOW,
    );
    expect(chosen?.id).toBe("recent");
  });

  it("falls to an upcoming session within the window when everything past is settled", () => {
    const chosen = chooseBookingToSettle(
      [bk({ id: "done", startsAt: day(-5), paid: true }), bk({ id: "soon", startsAt: day(3) })],
      NOW,
    );
    expect(chosen?.id).toBe("soon");
  });

  it("does not settle an upcoming session further out than the window", () => {
    const chosen = chooseBookingToSettle([bk({ id: "far", startsAt: day(20) })], NOW);
    expect(chosen).toBeNull();
  });

  it("never settles a cancelled session — that would be a goodwill call, not an automatic one", () => {
    expect(chooseBookingToSettle([bk({ id: "gone", status: "cancelled" })], NOW)).toBeNull();
  });

  it("returns null when there is nothing to settle", () => {
    expect(chooseBookingToSettle([], NOW)).toBeNull();
    expect(chooseBookingToSettle([bk({ paid: true })], NOW)).toBeNull();
  });
});

describe("matchNameAndAmount", () => {
  const jono = { clientId: "jono", name: "Jono Smith", bookings: [bk({ id: "j1", amountPence: 6000 })] };
  const sarah = { clientId: "sarah", name: "Sarah Kimani", bookings: [bk({ id: "s1", amountPence: 6000 })] };

  it("matches when the whole name is on the transfer and the amount is the session's price", () => {
    expect(matchNameAndAmount("MR JONO SMITH", 6000, NOW, [jono, sarah])).toEqual({
      status: "matched",
      clientId: "jono",
      bookingId: "j1",
    });
  });

  it("does not match on the name when the amount differs — that goes to a human", () => {
    expect(matchNameAndAmount("JONO SMITH", 5000, NOW, [jono])).toEqual({ status: "none" });
  });

  it("does not match on an initial and surname, or a first name alone", () => {
    expect(matchNameAndAmount("J SMITH", 6000, NOW, [jono])).toEqual({ status: "none" });
    expect(matchNameAndAmount("JONO", 6000, NOW, [jono])).toEqual({ status: "none" });
  });

  it("never matches a client saved under a single name", () => {
    const mono = { clientId: "m", name: "Jono", bookings: [bk({ amountPence: 6000 })] };
    expect(matchNameAndAmount("JONO SMITH", 6000, NOW, [mono])).toEqual({ status: "none" });
  });

  it("never matches a sliding-scale session with no price recorded", () => {
    const open = { ...jono, bookings: [bk({ id: "j1", amountPence: null })] };
    expect(matchNameAndAmount("JONO SMITH", 6000, NOW, [open])).toEqual({ status: "none" });
  });

  it("uses the amount to tell two clients with the same name apart", () => {
    const other = { clientId: "jono2", name: "Jono Smith", bookings: [bk({ id: "k1", amountPence: 4500 })] };
    expect(matchNameAndAmount("JONO SMITH", 4500, NOW, [jono, other])).toEqual({
      status: "matched",
      clientId: "jono2",
      bookingId: "k1",
    });
  });

  it("refuses to guess when two clients fit on name and amount", () => {
    const twin = { clientId: "jono2", name: "Jono Smith", bookings: [bk({ id: "k1", amountPence: 6000 })] };
    expect(matchNameAndAmount("JONO SMITH", 6000, NOW, [jono, twin])).toEqual({
      status: "ambiguous",
      clientIds: ["jono", "jono2"],
    });
  });

  it("only checks the session the payment would settle, inside the same window", () => {
    // Oldest owed is £80; a £60 transfer doesn't skip past it to a newer £60 one.
    const two = { ...jono, bookings: [bk({ id: "old", startsAt: day(-6), amountPence: 8000 }), bk({ id: "new", amountPence: 6000 })] };
    expect(matchNameAndAmount("JONO SMITH", 6000, NOW, [two])).toEqual({ status: "none" });
    const stale = { ...jono, bookings: [bk({ id: "j1", startsAt: day(-30), amountPence: 6000 })] };
    expect(matchNameAndAmount("JONO SMITH", 6000, NOW, [stale])).toEqual({ status: "none" });
  });
});
