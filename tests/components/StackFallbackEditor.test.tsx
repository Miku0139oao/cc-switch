import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StackFallbackEditor } from "@/components/providers/mode/StackFallbackEditor";
import type { Provider } from "@/types";
import type { ProxyStack } from "@/types/proxy";

vi.mock("@/lib/query/proxy", () => ({
  useSetStackFallbackChain: () => ({
    mutateAsync: vi.fn(),
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
};

describe("StackFallbackEditor", () => {
  it("lists every published primary model and its chain count", () => {
    render(
      <StackFallbackEditor app="claude" stack={stack} providers={providers} />,
    );

    expect(screen.getByText("Kimi K3")).toBeInTheDocument();
    expect(screen.getByText(/mode\.fallback\.count/)).toBeInTheDocument();
    expect(screen.getAllByText("mode.fallback.configure").length).toBe(2);
  });

  it("does not render before an aggregation inventory exists", () => {
    const { container } = render(
      <StackFallbackEditor
        app="claude"
        stack={{ active: false, members: [] }}
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
});
