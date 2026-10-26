import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StackFallbackEditor } from "@/components/providers/mode/StackFallbackEditor";
import type { Provider } from "@/types";
import type { ProxyStack } from "@/types/proxy";

Element.prototype.scrollIntoView ??= vi.fn();

vi.mock("@/lib/query/proxy", () => ({
  useSetStackFallbackChain: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

const providers = {
  kimi: { id: "kimi", name: "Kimi", settingsConfig: {} },
  glm: { id: "glm", name: "GLM", settingsConfig: {} },
  other: { id: "other", name: "Other Provider", settingsConfig: {} },
} as unknown as Record<string, Provider>;

const stack: ProxyStack = {
  active: true,
  members: [
    {
      providerId: "kimi",
      route: true,
      modelIds: ["ccs-claude-kimi--kimi-k3"],
      memberModels: 1,
      models: [
        {
          id: "ccs-claude-kimi--kimi-k3",
          upstreamModel: "kimi-k3",
          displayName: "Kimi K3",
        },
      ],
    },
    {
      providerId: "glm",
      route: false,
      modelIds: ["ccs-claude-glm--glm-5"],
      memberModels: 1,
      models: [
        {
          id: "ccs-claude-glm--glm-5",
          upstreamModel: "glm-5",
          displayName: "GLM 5",
        },
      ],
    },
  ],
  fallbacks: {
    "ccs-claude-kimi--kimi-k3": [{ providerId: "glm", upstreamModel: "glm-5" }],
  },
  balanceStrategy: "priority",
  balanceWeights: { kimi: 1, glm: 1 },
  balancedSessionCount: 0,
};

describe("StackFallbackEditor", () => {
  it("lists every published primary model and its chain count", () => {
    render(
      <StackFallbackEditor app="claude" stack={stack} providers={providers} />,
    );

    expect(screen.getByText("Kimi K3")).toBeInTheDocument();
    expect(screen.getByText(/mode\.fallback\.customCount/)).toBeInTheDocument();
    expect(screen.getAllByText("mode.fallback.configure").length).toBe(2);
  });

  it("does not render before an aggregation inventory exists", () => {
    const { container } = render(
      <StackFallbackEditor
        app="claude"
        stack={{
          active: false,
          members: [],
          balanceStrategy: "priority",
          balanceWeights: {},
          balancedSessionCount: 0,
        }}
        providers={providers}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the automatic priority chain when no explicit override exists", () => {
    const autoStack: ProxyStack = {
      ...stack,
      fallbacks: undefined,
      effectiveFallbacks: {
        "ccs-claude-kimi--kimi-k3": [
          { providerId: "glm", upstreamModel: "glm-5" },
        ],
        "ccs-claude-glm--glm-5": [
          { providerId: "kimi", upstreamModel: "kimi-k3" },
        ],
      },
    };

    render(
      <StackFallbackEditor
        app="claude"
        stack={autoStack}
        providers={providers}
      />,
    );

    expect(screen.getAllByText(/mode\.fallback\.autoCount/)).toHaveLength(2);
  });

  it("starts with the automatic chain and exposes a searchable custom picker", async () => {
    const user = userEvent.setup();
    const autoStack: ProxyStack = {
      ...stack,
      fallbacks: undefined,
      effectiveFallbacks: {
        "ccs-claude-kimi--kimi-k3": [
          { providerId: "glm", upstreamModel: "glm-5" },
        ],
      },
    };
    render(
      <StackFallbackEditor
        app="claude"
        stack={autoStack}
        providers={providers}
      />,
    );

    await user.click(screen.getAllByText("mode.fallback.configure")[0]);
    expect(screen.getByText("mode.fallback.automaticTitle")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "mode.fallback.customMode" }),
    );
    expect(screen.getByText("mode.fallback.customHint")).toBeVisible();

    await user.click(screen.getByRole("combobox"));
    expect(
      screen.getByPlaceholderText("mode.fallback.searchCandidate"),
    ).toBeVisible();
  });

  it("groups candidates by provider for custom fallback selection", async () => {
    const user = userEvent.setup();
    const stackWithOther: ProxyStack = {
      ...stack,
      members: [
        ...stack.members,
        {
          providerId: "other",
          route: false,
          modelIds: ["ccs-claude-other--mistral-large"],
          memberModels: 1,
          models: [
            {
              id: "ccs-claude-other--mistral-large",
              upstreamModel: "mistral-large",
              displayName: "Mistral Large",
            },
          ],
        },
      ],
    };
    render(
      <StackFallbackEditor
        app="claude"
        stack={stackWithOther}
        providers={providers}
      />,
    );

    await user.click(screen.getAllByText("mode.fallback.configure")[0]);
    await user.click(screen.getByRole("combobox"));
    const picker = screen.getByRole("listbox");
    expect(within(picker).getByText(/Other Provider/)).toBeVisible();
    await user.click(within(picker).getByText("Mistral Large"));
    expect(screen.getByText("Mistral Large · Other Provider")).toBeVisible();
  });
});
