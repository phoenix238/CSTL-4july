import { describe, it, expect } from "vitest";
import {
  chooseBookingToSettle,
  matchReference,
  normaliseRef,
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
