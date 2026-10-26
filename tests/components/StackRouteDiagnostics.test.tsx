import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildStackDiagnosticRoutes,
  StackRouteDiagnostics,
} from "@/components/providers/mode/StackRouteDiagnostics";
import type { Provider } from "@/types";
import type { ProxyStack } from "@/types/proxy";

const providers: Record<string, Provider> = {
  primary: {
    id: "primary",
    name: "Command Code",
    settingsConfig: {},
  },
  fallback: {
    id: "fallback",
    name: "DeepSeek",
    settingsConfig: {},
  },
};

const stack: ProxyStack = {
  active: false,
  members: [
    {
      providerId: "primary",
      modelIds: ["ccs-claude-opencode-2--deepseek-v4.1-flash[1M]"],
      route: false,
      memberModels: 1,
      models: [
        {
          id: "ccs-claude-opencode-2--deepseek-v4.1-flash[1M]",
          upstreamModel: "deepseek-v4.1-flash[1M]",
          displayName: "DeepSeek V4.1 Flash",
        },
      ],
    },
    {
      providerId: "fallback",
      modelIds: [],
      route: true,
      memberModels: 1,
      models: [],
    },
  ],
  fallbacks: {
    "ccs-claude-opencode-2--deepseek-v4.1-flash[1M]": [
      { providerId: "fallback", upstreamModel: "deepseek-flash" },
    ],
  },
  effectiveFallbacks: {
    "ccs-claude-opencode-2--deepseek-v4.1-flash[1M]": [
      { providerId: "fallback", upstreamModel: "deepseek-flash" },
    ],
  },
  balanceStrategy: "priority",
  balanceWeights: {},
  balancedSessionCount: 3,
};

describe("StackRouteDiagnostics", () => {
  it("shows the client model, primary provider and upstream fallback", () => {
    expect(buildStackDiagnosticRoutes(stack, providers)).toEqual([
      expect.objectContaining({
        clientModelId: "ccs-claude-opencode-2--deepseek-v4.1-flash[1M]",
        providerName: "Command Code",
        upstreamModel: "deepseek-v4.1-flash[1M]",
        fallbacks: [
          {
            providerId: "fallback",
            providerName: "DeepSeek",
            upstreamModel: "deepseek-flash",
          },
        ],
      }),
    ]);

    render(
      <StackRouteDiagnostics
        app="claude"
        stack={stack}
        providers={providers}
      />,
    );

    expect(screen.getByText("DeepSeek V4.1 Flash")).toBeInTheDocument();
    expect(
      screen.getByText("ccs-claude-opencode-2--deepseek-v4.1-flash[1M]"),
    ).toBeInTheDocument();
    expect(screen.getByText("Command Code")).toBeInTheDocument();
    expect(screen.getByText("deepseek-flash")).toBeInTheDocument();
    expect(screen.getByText(/這份名單目前只保存設定/)).toBeInTheDocument();
    expect(screen.getByText(/harness 顯示名稱/)).toBeInTheDocument();
  });
});
