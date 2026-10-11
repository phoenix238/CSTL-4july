import { describe, expect, it } from "vitest";
import { blankSpace, legacySpaces } from "@/lib/spaces";
import {
  blockedRange,
  EVENT_REMINDERS,
  NO_REMINDERS,
  personalEventReminders,
  planBookingEvents,
} from "./rules";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 7, h, m));

// Phoenix's two clinics exactly as an install that has never saved its spaces
// resolves them — these tests prove the generic planner still produces the
// events the hard-wired one did.
const legacy = (address = { waterlooAddress: "", bethnalAddress: "" }) => {
  const [b, w] = legacySpaces(address);
  return { waterloo: w, bethnal: b };
};

describe("planBookingEvents", () => {
  it("Waterloo creates two 1-hour events: personal + R5 room, personal titled anonymously", () => {
    const plan = planBookingEvents(legacy({ waterlooAddress: "1 Rd, London", bethnalAddress: "" }).waterloo, at(9));
    expect(plan).toHaveLength(2);

    const personal = plan.find((e) => e.calendar === "personal")!;
    // No client name in the title — but the real address is still the location,
    // so Google can still drop a pin and the client can navigate.
    expect(personal.summary).toBe("Craniosacral therapy");
    expect(personal.location).toBe("1 Rd, London");
    expect(personal.start).toEqual(at(9));
    expect(personal.end).toEqual(at(10));
    expect(personal.inviteClient).toBe(true);

    const room = plan.find((e) => e.calendar === "venue")!;
    expect(room.summary).toBe("R5 - Phoenix");
    expect(room.start).toEqual(at(9));
    expect(room.end).toEqual(at(10));
    expect(room.inviteClient).toBe(false);
  });

  it("falls back to the clinic name as location only when no address is set yet", () => {
    const personal = planBookingEvents(legacy().waterloo, at(9)).find((e) => e.calendar === "personal")!;
    expect(personal.location).toBe("Waterloo");
  });

  it("puts the venue note on the room event's description, and nowhere client-facing", () => {
    const note = "Craniosacral session 09:00–10:00.\nContact Phoenix: 07000 000000";
    const plan = planBookingEvents(legacy({ waterlooAddress: "1 Rd, London", bethnalAddress: "" }).waterloo, at(9), note);

    const room = plan.find((e) => e.calendar === "venue")!;
    expect(room.description).toBe(note);

    // The client's own (personal) event never carries the venue note.
    const personal = plan.find((e) => e.calendar === "personal")!;
    expect(personal.description).toBeUndefined();
  });

  it("leaves the room description unset when no venue note is given", () => {
    const room = planBookingEvents(legacy().waterloo, at(9)).find((e) => e.calendar === "venue")!;
    expect(room.description).toBeUndefined();
  });

  it("Bethnal Green creates just the 1h personal session — the shared Chalk Farm block is computed separately", () => {
    const plan = planBookingEvents(legacy({ waterlooAddress: "", bethnalAddress: "2 Rd, London" }).bethnal, at(14));
    expect(plan).toHaveLength(1);

    const personal = plan[0];
    expect(personal.calendar).toBe("personal");
    expect(personal.summary).toBe("Craniosacral therapy");
    expect(personal.location).toBe("2 Rd, London");
    expect(personal.start).toEqual(at(14));
    expect(personal.end).toEqual(at(15));
    expect(personal.inviteClient).toBe(true);
  });

  it("colours each clinic's session so a glance at the calendar says where you are", () => {
    const bethnal = planBookingEvents(legacy().bethnal, at(14))[0];
    const waterloo = planBookingEvents(legacy().waterloo, at(9)).find((e) => e.calendar === "personal")!;

    expect(bethnal.colorId).toBe("4"); // Flamingo, as before
    expect(waterloo.colorId).toBe("6"); // Tangerine, as before
    // The two clinics must never be given the same colour — telling them apart
    // at a glance is the entire point.
    expect(bethnal.colorId).not.toBe(waterloo.colorId);
  });

  it("uses ids from Google's eleven-colour event palette", () => {
    // Anything outside 1–11 is silently rejected by Google and the event comes
    // back the calendar's default colour, with no error to notice.
    for (const id of Object.values(legacy()).map((sp) => sp.eventColor)) {
      expect(Number(id)).toBeGreaterThanOrEqual(1);
      expect(Number(id)).toBeLessThanOrEqual(11);
      expect(id).toMatch(/^\d+$/);
    }
  });

  it("leaves the shared room event uncoloured — it lives on the venue's calendar", () => {
    const room = planBookingEvents(legacy().waterloo, at(9)).find((e) => e.calendar === "venue")!;
    expect(room.colorId).toBeUndefined();
  });
});

describe("planBookingEvents for a space of your own", () => {
  it("a space with no venue calendar creates only your own session event", () => {
    const space = { ...blankSpace("garden", "Garden Room"), address: "3 Lane, Bristol", eventColor: "2" };
    const plan = planBookingEvents(space, at(11));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ calendar: "personal", location: "3 Lane, Bristol", colorId: "2" });
  });

  it("a per-session room venue gets its own titled event — never a client's name", () => {
    const space = { ...blankSpace("studio", "Studio"), venueMode: "room" as const, venueEventTitle: "Studio 2 - Emily" };
    const venue = planBookingEvents(space, at(11)).find((e) => e.calendar === "venue")!;
    expect(venue.summary).toBe("Studio 2 - Emily");
    expect(venue.inviteClient).toBe(false);
  });
});

describe("personalEventReminders", () => {
  const cfg = (over: Partial<Parameters<typeof personalEventReminders>[0]> = {}) => ({
    ownReminderMode: "morning",
    ownReminderMinutesBefore: 60,
    ownReminderMorningHour: 8,
    ...over,
  });

  it("morning mode turns 08:00 into a relative offset for an afternoon session", () => {
    // 15:00 session, morning hour 8 → popup 7h (420 min) before, i.e. at 08:00.
    expect(personalEventReminders(cfg(), 15 * 60)).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 420 }],
    });
  });

  it("morning mode falls back to minutes-before for a session at/before the morning hour", () => {
    // 07:00 session can't be reminded 'that morning' any earlier, so it uses the before popup.
    expect(personalEventReminders(cfg(), 7 * 60)).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 60 }],
    });
  });

  it("before mode is a single popup at the chosen offset", () => {
    expect(personalEventReminders(cfg({ ownReminderMode: "before", ownReminderMinutesBefore: 90 }), 10 * 60)).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 90 }],
    });
  });

  it("email_popup mode keeps the legacy email+popup pair", () => {
    expect(personalEventReminders(cfg({ ownReminderMode: "email_popup" }), 10 * 60)).toEqual(EVENT_REMINDERS);
  });

  it("none mode puts no reminder on the event", () => {
    expect(personalEventReminders(cfg({ ownReminderMode: "none" }), 10 * 60)).toEqual(NO_REMINDERS);
  });
});

describe("blockedRange", () => {
  it("Waterloo blocks only the session hour", () => {
    expect(blockedRange("waterloo", at(9))).toEqual({ start: at(9), end: at(10) });
  });
  it("Bethnal also blocks only the session hour — no room padding, sessions can sit close together", () => {
    expect(blockedRange("bethnal", at(14))).toEqual({ start: at(14), end: at(15) });
  });
});
