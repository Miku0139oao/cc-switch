import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalProviderImpactDialog } from "@/components/settings/auth/GlobalProviderImpactDialog";
import type { UniversalProvider, UniversalProviderStatus } from "@/types";

const provider: UniversalProvider = {
  id: "shared",
  name: "Shared Relay",
  providerType: "custom",
  apps: { claude: true, codex: true, gemini: true },
  baseUrl: "https://relay.example/v1",
  apiKey: "sk-secret",
  models: {},
};

const status: UniversalProviderStatus = {
  id: "shared",
  lastSyncedAt: 1_700_000_000,
  children: [
    {
      app: "claude",
      childId: "universal-claude-shared",
      exists: true,
      inUse: true,
      inStack: false,
      inFailoverQueue: false,
      inSync: true,
      changedFields: [],
      livePath: "~/.claude/settings.json",
    },
    {
      app: "codex",
      childId: "universal-codex-shared",
      exists: true,
      inUse: false,
      inStack: true,
      inFailoverQueue: false,
      inSync: false,
      changedFields: ["config"],
      livePath: "~/.codex/config.toml",
    },
    {
      app: "gemini",
      childId: "universal-gemini-shared",
      exists: false,
      inUse: false,
      inStack: false,
      inFailoverQueue: false,
      inSync: null,
      changedFields: [],
      livePath: "~/.gemini/.env",
    },
  ],
};

function renderDialog(mode: "sync" | "delete") {
  return render(
    <GlobalProviderImpactDialog
      mode={mode}
      provider={provider}
      status={status}
      busy={false}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe("GlobalProviderImpactDialog", () => {
  it("blocks deletion while an agent is using the provider", () => {
    renderDialog("delete");

    expect(screen.getByText("正在使用，後端會拒絕刪除")).toBeInTheDocument();
    expect(
      screen.getByText("會移出聚合名單；已發布的 ccs-* 模型 id 會失效"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "刪除全域供應商" }),
    ).toBeDisabled();
  });

  it("lists the fields a sync will overwrite and the child it will create", () => {
    renderDialog("sync");

    expect(screen.getByText("會覆蓋這些欄位：config")).toBeInTheDocument();
    expect(
      screen.getByText("會建立可選用的子卡；不會切換目前供應商"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開始同步" })).toBeEnabled();
  });
});
