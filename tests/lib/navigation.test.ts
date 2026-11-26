import { describe, expect, it } from "vitest";
import { isAppPage, parseView } from "@/lib/navigation";

describe("navigation", () => {
  it("recognizes the dedicated global providers page", () => {
    expect(parseView("globalProviders")).toBe("globalProviders");
    expect(isAppPage("globalProviders")).toBe(false);
  });

  it("keeps ignoring unknown views", () => {
    expect(parseView("globalProvider")).toBeNull();
  });
});
