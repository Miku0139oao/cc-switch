import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StackRoutingEvents } from "@/components/providers/mode/StackRoutingEvents";
import type { Provider } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@/lib/query/proxy", () => ({
  useStackFallbackEvents: () => ({
    data: [
      {
        id: 1,
        sessionId: "s1",
        appType: "claude",
        logicalModel: "ccs-claude-aa--model-b",
        attemptIndex: 0,
        failedProviderId: "primary",
        nextProviderId: "backup",
        nextModel: "model-b",
        errorClass: "rate_limited",
        createdAt: 1_700_000_000,
      },
    ],
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

const providers: Record<string, Provider> = {
  primary: { id: "primary", name: "Primary Relay", settingsConfig: {} },
  backup: { id: "backup", name: "Backup Relay", settingsConfig: {} },
};

describe("StackRoutingEvents", () => {
  it("shows the failed provider, the next provider and the logical model", () => {
    render(<StackRoutingEvents app="claude" providers={providers} enabled />);

    expect(screen.getByText("Primary Relay")).toBeInTheDocument();
    expect(screen.getByText("Backup Relay")).toBeInTheDocument();
    expect(screen.getByText("model-b")).toBeInTheDocument();
    expect(screen.getByText("rate_limited")).toBeInTheDocument();
    expect(screen.getByText("ccs-claude-aa--model-b")).toBeInTheDocument();
  });
});
