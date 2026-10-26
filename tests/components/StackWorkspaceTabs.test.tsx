import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  StackWorkspaceTabs,
  type StackWorkspaceTab,
} from "@/components/providers/mode/StackWorkspaceTabs";

function renderTabs(active: boolean, tab: StackWorkspaceTab = "members") {
  const onTab = vi.fn();
  const onActivate = vi.fn();
  render(
    <StackWorkspaceTabs
      active={active}
      tab={tab}
      onTab={onTab}
      defaultName="Relay"
      memberCount={2}
      publishedModels={3}
      strategy="Priority"
      onActivate={onActivate}
    />,
  );
  return { onTab, onActivate };
}

describe("StackWorkspaceTabs", () => {
  it("explains that an inactive stack is only a preview and offers activation", () => {
    const { onActivate } = renderTabs(false);

    expect(screen.getByText("預覽中 · 尚未生效")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "切換到聚合模式" }));
    expect(onActivate).toHaveBeenCalled();
  });

  it("shows the summary and switches sections", () => {
    const { onTab } = renderTabs(true, "members");

    expect(screen.queryByText("預覽中 · 尚未生效")).not.toBeInTheDocument();
    expect(screen.getByText("Relay")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "診斷" }));
    expect(onTab).toHaveBeenCalledWith("diagnostics");
  });
});
