import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LocalProviderAccounts,
  type LocalProviderRow,
} from "@/components/settings/auth/LocalProviderAccounts";
import type { Provider } from "@/types";

const rows: LocalProviderRow[] = [
  {
    appId: "claude",
    current: true,
    provider: {
      id: "deepseek",
      name: "DeepSeek",
      settingsConfig: {
        env: { ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic" },
      },
    } as Provider,
  },
  {
    appId: "codex",
    current: false,
    provider: {
      id: "quickrouter",
      name: "QuickRouter",
      settingsConfig: {
        config:
          'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://router.example.com/v1"',
      },
    } as Provider,
  },
];

describe("LocalProviderAccounts", () => {
  it("lists existing providers and opens their source app", () => {
    const onOpenApp = vi.fn();
    render(<LocalProviderAccounts rows={rows} onOpenApp={onOpenApp} />);

    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("QuickRouter")).toBeInTheDocument();
    expect(screen.getByText("api.deepseek.com")).toBeInTheDocument();
    expect(screen.getAllByText("默认")).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText("搜索供应商、App 或地址"), {
      target: { value: "quick" },
    });
    expect(screen.queryByText("DeepSeek")).not.toBeInTheDocument();
    expect(screen.getByText("QuickRouter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "在 Codex 中管理" }));
    expect(onOpenApp).toHaveBeenCalledWith("codex");
  });
});
