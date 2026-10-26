import { describe, expect, it } from "vitest";
import { isGlobalPage, parseView } from "@/lib/navigation";

describe("navigation", () => {
  it("recognizes the dedicated global providers page", () => {
    expect(parseView("globalProviders")).toBe("globalProviders");
    expect(isGlobalPage("globalProviders")).toBe(true);
  });

  it("keeps ignoring unknown views", () => {
    expect(parseView("globalProvider")).toBeNull();
  });
});
