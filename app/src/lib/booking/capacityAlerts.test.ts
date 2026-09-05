import { describe, expect, it } from "vitest";
import { diffCapacityAlerts, type CapacityIssue } from "./capacityAlerts";

const asOf = new Date("2026-09-05T09:00:00Z");

const issue = (dateKey: string, clinic: "waterloo" | "bethnal" = "bethnal"): CapacityIssue => ({
  key: `${clinic}:${dateKey}`,
  clinic,
  dateKey,
  reason: "Weekly Chalk Farm hours cap reached for this week",
});

describe("diffCapacityAlerts", () => {
  it("treats every issue as new when nothing was previously alerted", () => {
    const { newIssues, nextAlerted } = diffCapacityAlerts([issue("2026-09-07")], {}, asOf);
    expect(newIssues).toEqual([issue("2026-09-07")]);
    expect(nextAlerted).toEqual({ "bethnal:2026-09-07": asOf.toISOString() });
  });

  it("does not re-report a day already alerted, and keeps its original timestamp", () => {
    const firstAlerted = "2026-09-04T09:00:00.000Z";
    const { newIssues, nextAlerted } = diffCapacityAlerts(
      [issue("2026-09-07")],
      { "bethnal:2026-09-07": firstAlerted },
      asOf,
    );
    expect(newIssues).toEqual([]);
    expect(nextAlerted).toEqual({ "bethnal:2026-09-07": firstAlerted });
  });

  it("drops a day from the map once it's no longer an issue — a later recurrence re-alerts", () => {
    const { nextAlerted } = diffCapacityAlerts([], { "bethnal:2026-09-07": "2026-09-04T09:00:00.000Z" }, asOf);
    expect(nextAlerted).toEqual({});
  });

  it("only reports the days that are actually new, alongside ones already known", () => {
    const known = "2026-09-04T09:00:00.000Z";
    const { newIssues, nextAlerted } = diffCapacityAlerts(
      [issue("2026-09-07"), issue("2026-09-08")],
      { "bethnal:2026-09-07": known },
      asOf,
    );
    expect(newIssues).toEqual([issue("2026-09-08")]);
    expect(nextAlerted).toEqual({
      "bethnal:2026-09-07": known,
      "bethnal:2026-09-08": asOf.toISOString(),
    });
  });
});
