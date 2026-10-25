import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalSupplierAccounts } from "@/components/settings/auth/GlobalSupplierAccounts";
import type { UniversalProvider } from "@/types";

const mockData = vi.hoisted(() => ({
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    providerType: "custom",
    apps: { claude: true, codex: true, gemini: false },
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-secret-1234",
    models: {},
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    providerType: "custom",
    apps: { claude: false, codex: false, gemini: true },
    baseUrl: "https://openrouter.ai/api",
    apiKey: "sk-or-secret-9876",
    models: {},
  },
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  universalProvidersApi: {
    getAll: vi.fn().mockResolvedValue(mockData),
    sync: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/components/universal/UniversalProviderFormModal", () => ({
  UniversalProviderFormModal: ({
    isOpen,
    editingProvider,
  }: {
    isOpen: boolean;
    editingProvider?: UniversalProvider | null;
  }) => (isOpen ? <div>form:{editingProvider?.name ?? "new"}</div> : null),
}));

describe("GlobalSupplierAccounts", () => {
  it("lists shared providers with their available agents and edit action", async () => {
    render(<GlobalSupplierAccounts />);

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    expect(screen.getByText("api.deepseek.com")).toBeInTheDocument();
    expect(screen.getByText("••••••••1234")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/供應商或 Endpoint/), {
      target: { value: "openrouter" },
    });
    expect(screen.queryByText("DeepSeek")).not.toBeInTheDocument();
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    expect(screen.getByText("form:OpenRouter")).toBeInTheDocument();
  });
});
