import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalSupplierAgentDialog } from "@/components/settings/auth/GlobalSupplierAgentDialog";
import type { UniversalProvider } from "@/types";

const provider: UniversalProvider = {
  id: "provider-1",
  name: "DeepSeek",
  providerType: "custom",
  apps: { claude: false, codex: true, gemini: false },
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKey: "sk-secret",
  models: {
    codex: { model: "deepseek-v4-flash" },
  },
};

describe("GlobalSupplierAgentDialog", () => {
  it("assigns an additional agent only after its model is configured", () => {
    const onSave = vi.fn();

    render(
      <GlobalSupplierAgentDialog
        provider={provider}
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const apply = screen.getByRole("button", {
      name: "套用並同步",
    });
    expect(apply).toBeEnabled();

    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(apply).toBeDisabled();

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Claude Code 主模型",
      }),
      { target: { value: "deepseek-v4-pro" } },
    );
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "provider-1",
        apps: { claude: true, codex: true, gemini: false },
        models: expect.objectContaining({
          claude: expect.objectContaining({ model: "deepseek-v4-pro" }),
          codex: expect.objectContaining({ model: "deepseek-v4-flash" }),
        }),
      }),
    );
  });
});
