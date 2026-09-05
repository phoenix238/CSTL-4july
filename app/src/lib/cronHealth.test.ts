import { describe, expect, it } from "vitest";
import { isCronStale } from "./cronHealth";

const now = new Date("2026-09-05T12:00:00Z");

describe("isCronStale", () => {
  it("is stale when there's no heartbeat at all", () => {
    expect(isCronStale(null, now)).toBe(true);
  });

  it("is not stale just under the default 48h window", () => {
    const lastRun = new Date(now.getTime() - 47 * 3600_000);
    expect(isCronStale(lastRun, now)).toBe(false);
  });

  it("is stale just over the default 48h window", () => {
    const lastRun = new Date(now.getTime() - 49 * 3600_000);
    expect(isCronStale(lastRun, now)).toBe(true);
  });

  it("respects a custom threshold", () => {
    const lastRun = new Date(now.getTime() - 10 * 3600_000);
    expect(isCronStale(lastRun, now, 6)).toBe(true);
    expect(isCronStale(lastRun, now, 24)).toBe(false);
  });

  it("is not stale for a heartbeat from right now", () => {
    expect(isCronStale(now, now)).toBe(false);
  });
});
