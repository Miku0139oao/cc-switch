import { useTranslation } from "react-i18next";
import { Eye, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type StackWorkspaceTab =
  | "members"
  | "models"
  | "balance"
  | "diagnostics";

interface StackWorkspaceTabsProps {
  active: boolean;
  tab: StackWorkspaceTab;
  onTab: (tab: StackWorkspaceTab) => void;
  defaultName: string;
  memberCount: number;
  publishedModels: number;
  strategy: string;
  onActivate: () => void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-fg-3">{label}</span>
      <span className="min-w-0 truncate font-medium text-fg-1">{value}</span>
    </span>
  );
}

/**
 * 聚合頁的工作台列：生效狀態 + 摘要 + 分區。分區是「同一個設定頁裡看哪一塊」，
 * 所以用 SegmentedControl（頁內篩選），不是 PageTabs（換頁）。
 */
export function StackWorkspaceTabs({
  active,
  tab,
  onTab,
  defaultName,
  memberCount,
  publishedModels,
  strategy,
  onActivate,
}: StackWorkspaceTabsProps) {
  const { t } = useTranslation();

  return (
    <section className="mb-4 overflow-hidden rounded-panel border border-border bg-surface">
      {!active && (
        <div className="flex flex-wrap items-center gap-3 border-b border-stack-border bg-stack-soft px-4 py-2.5">
          <Eye className="h-4 w-4 shrink-0 text-stack-text" />
          <div className="min-w-0 flex-1">
            <div className="text-body font-semibold text-stack-text">
              {t("mode.workspace.previewTitle", {
                defaultValue: "預覽中 · 尚未生效",
              })}
            </div>
            <div className="text-caption text-fg-2">
              {t("mode.workspace.previewHint", {
                defaultValue:
                  "這些設定會保存，但用戶端目前不會看到聚合模型；切換到聚合模式後才會發布。",
              })}
            </div>
          </div>
          <Button
            type="button"
            variant="stack"
            size="compact"
            onClick={onActivate}
          >
            <Layers className="h-3.5 w-3.5" />
            {t("mode.workspace.activate", {
              defaultValue: "切換到聚合模式",
            })}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <SegmentedControl
          size="sm"
          value={tab}
          onValueChange={(value) => onTab(value as StackWorkspaceTab)}
          aria-label={t("mode.workspace.tabsLabel", {
            defaultValue: "聚合設定分區",
          })}
          items={[
            {
              value: "members",
              label: t("mode.workspace.tabMembers", {
                defaultValue: "成員",
              }),
            },
            {
              value: "models",
              label: t("mode.workspace.tabModels", {
                defaultValue: "模型與路由",
              }),
            },
            {
              value: "balance",
              label: t("mode.workspace.tabBalance", {
                defaultValue: "平衡",
              }),
            },
            {
              value: "diagnostics",
              label: t("mode.workspace.tabDiagnostics", {
                defaultValue: "診斷",
              }),
            },
          ]}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-caption">
          <Metric
            label={t("mode.workspace.defaultProvider", {
              defaultValue: "預設",
            })}
            value={defaultName}
          />
          <Metric
            label={t("mode.workspace.memberCount", {
              defaultValue: "成員",
            })}
            value={String(memberCount)}
          />
          <Metric
            label={t("mode.workspace.publishedModels", {
              defaultValue: "已發布模型",
            })}
            value={String(publishedModels)}
          />
          <Metric
            label={t("mode.workspace.strategy", {
              defaultValue: "平衡",
            })}
            value={strategy}
          />
        </div>
      </div>
    </section>
  );
}
