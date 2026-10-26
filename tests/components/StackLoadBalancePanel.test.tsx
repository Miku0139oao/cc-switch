import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StackLoadBalancePanel } from "@/components/providers/mode/StackLoadBalancePanel";
import type { Provider } from "@/types";
import type { ProxyStack } from "@/types/proxy";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock("@/lib/query/proxy", () => ({
  useSetStackBalancePolicy: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
}));

const providers = {
  kimi: { id: "kimi", name: "Kimi", settingsConfig: {} },
  glm: { id: "glm", name: "GLM", settingsConfig: {} },
} as unknown as Record<string, Provider>;

const stack: ProxyStack = {
  active: true,
  members: [
    {
      providerId: "kimi",
      route: true,
      modelIds: ["ccs-claude-kimi--kimi-k3"],
      memberModels: 1,
      models: [],
    },
    {
      providerId: "glm",
      route: false,
      modelIds: ["ccs-claude-glm--glm-5"],
      memberModels: 1,
      models: [],
    },
  ],
  balanceStrategy: "weightedRoundRobin",
  balanceWeights: { kimi: 1, glm: 1 },
  balancedSessionCount: 4,
};

describe("StackLoadBalancePanel", () => {
  it("shows sticky sessions and applies provider weight changes once", async () => {
    const user = userEvent.setup();
    render(
      <StackLoadBalancePanel
        app="claude"
        stack={stack}
        providers={providers}
      />,
    );

    expect(screen.getByText("mode.balance.title")).toBeInTheDocument();
    expect(screen.getByText(/mode\.balance\.stickyCount/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("mode.balance.weightFor")[0]).toHaveValue(
      1,
    );

    await user.click(
      screen.getAllByRole("button", {
        name: "mode.balance.increase",
      })[0],
    );
    await user.click(
      screen.getByRole("button", { name: "mode.balance.apply" }),
    );

    expect(mocks.mutate).toHaveBeenCalledWith({
      appType: "claude",
      strategy: "weightedRoundRobin",
      weights: { kimi: 2, glm: 1 },
    });
  });
});
