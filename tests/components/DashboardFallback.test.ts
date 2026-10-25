import { describe, expect, it } from "vitest";
import { isFallbackTargetMissing } from "@/components/dashboard/DashboardPage";

describe("dashboard fallback readiness", () => {
  it("does not warn for direct connections", () => {
    expect(isFallbackTargetMissing("direct", undefined, 0, 0)).toBe(false);
  });

  it("waits for the auto-failover setting before warning", () => {
    expect(isFallbackTargetMissing("route", undefined, 0, 0)).toBe(false);
  });

  it("warns when route failover is disabled", () => {
    expect(isFallbackTargetMissing("route", false, 3, 0)).toBe(true);
  });

  it("requires a second route target", () => {
    expect(isFallbackTargetMissing("route", true, 1, 0)).toBe(true);
    expect(isFallbackTargetMissing("route", true, 2, 0)).toBe(false);
  });

  it("warns when an aggregated model has no fallback chain", () => {
    expect(isFallbackTargetMissing("stack", undefined, 0, 0)).toBe(true);
    expect(isFallbackTargetMissing("stack", undefined, 0, 1)).toBe(false);
  });
});
