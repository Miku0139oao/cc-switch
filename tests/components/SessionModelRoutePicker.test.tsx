import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionModelRoutePicker } from "@/components/sessions/reader/SessionModelRoutePicker";

const setRoute = vi.fn();
const clearRoute = vi.fn();

vi.mock("@/lib/query/sessions", () => ({
  useCodexSessionRoutes: () => ({ data: {} }),
  useCodexSessionModels: () => ({
    isLoading: false,
    data: [
      {
        providerId: "alpha",
        providerName: "Alpha Provider",
        upstreamModel: "gpt-alpha",
        official: false,
      },
      {
        providerId: "beta",
        providerName: "Beta Provider",
        upstreamModel: "gpt-beta",
        official: true,
      },
    ],
  }),
  useSetCodexSessionRoute: () => ({
    mutateAsync: setRoute,
    isPending: false,
  }),
  useClearCodexSessionRoute: () => ({
    mutateAsync: clearRoute,
    isPending: false,
  }),
}));

vi.mock("@/lib/query/proxy", () => ({
  useAppMode: () => ({ data: { mode: "route" } }),
}));

describe("SessionModelRoutePicker", () => {
  beforeEach(() => {
    setRoute.mockReset().mockResolvedValue(undefined);
    clearRoute.mockReset().mockResolvedValue(undefined);
  });

  it("pins a Codex session to a provider and model", async () => {
    const user = userEvent.setup();
    render(
      <SessionModelRoutePicker
        sessionId="thread-123"
        fallbackModel="gpt-current"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "sessionManager.sessionRoute.label",
    });
    expect(trigger).toHaveTextContent("gpt-current");
    await user.click(trigger);
    const provider = await screen.findByRole("menuitem", {
      name: /Alpha Provider/,
    });
    provider.focus();
    await user.keyboard("{ArrowRight}");
    await user.click(
      await screen.findByRole("menuitemradio", { name: "gpt-alpha" }),
    );

    await waitFor(() =>
      expect(setRoute).toHaveBeenCalledWith({
        sessionId: "thread-123",
        providerId: "alpha",
        upstreamModel: "gpt-alpha",
      }),
    );
  });
});
