import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  UsersRound,
} from "lucide-react";
import type {
  UniversalChildStatus,
  UniversalProvider,
  UniversalProviderStatus,
} from "@/types";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ProviderIcon } from "@/components/ProviderIcon";
import { SHARED_AGENTS, type SharedAgentId } from "./sharedAgents";

interface GlobalProviderDetailSheetProps {
  provider: UniversalProvider | null;
  status: UniversalProviderStatus | undefined;
  syncing: boolean;
  saving: boolean;
  onClose: () => void;
  onSync: (provider: UniversalProvider) => void;
  onAssign: (provider: UniversalProvider) => void;
  onEdit: (provider: UniversalProvider) => void;
  onDelete: (provider: UniversalProvider) => void;
  /** 前往某個 Agent 的供應商頁（沒有導航能力時不顯示） */
  onOpenAgent?: (app: SharedAgentId) => void;
}

function masked(value: string): string {
  if (!value) return "—";
  if (value.length <= 4) return "••••";
  return `••••••••${value.slice(-4)}`;
}

function formatTime(seconds: number | undefined): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function childFor(
  status: UniversalProviderStatus | undefined,
  app: SharedAgentId,
): UniversalChildStatus | undefined {
  return status?.children.find((child) => child.app === app);
}

function StateBadge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "muted" | "info";
  children: ReactNode;
}) {
  const className =
    tone === "success"
      ? "bg-success-soft text-success-text"
      : tone === "warning"
        ? "bg-warning-soft text-warning-text"
        : tone === "info"
          ? "bg-stack-soft text-stack-text"
          : "bg-subtle text-fg-2";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-badge font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * 全域供應商的「真實狀態」抽屜：universal id、子卡 id、live 檔路徑、被誰使用、
 * 哪些欄位和同步結果不同。刪除／同步的後果在按鈕上先講清楚。
 */
export function GlobalProviderDetailSheet({
  provider,
  status,
  syncing,
  saving,
  onClose,
  onSync,
  onAssign,
  onEdit,
  onDelete,
  onOpenAgent,
}: GlobalProviderDetailSheetProps) {
  const { t } = useTranslation();

  if (!provider) return null;

  const copy = async (value: string) => {
    try {
      await copyText(value);
      toast.success(t("common.copied", { defaultValue: "已複製" }));
    } catch {
      toast.error(t("common.copyFailed", { defaultValue: "無法複製" }));
    }
  };

  const agentsUsing = SHARED_AGENTS.filter(
    (agent) => childFor(status, agent.id)?.inUse,
  );
  const outOfSync = SHARED_AGENTS.filter((agent) => {
    const child = childFor(status, agent.id);
    // 應該發布但還沒建立，或建立了但和全域設定不同，都算「未同步」。
    if (provider.apps[agent.id] && !child?.exists) return true;
    return child?.exists && child.inSync === false;
  });
  const inStack = SHARED_AGENTS.filter(
    (agent) => childFor(status, agent.id)?.inStack,
  );
  const inQueue = SHARED_AGENTS.filter(
    (agent) => childFor(status, agent.id)?.inFailoverQueue,
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent width={520} closeLabel={t("common.close")}>
        <SheetHeader>
          <div className="flex min-w-0 items-center gap-3">
            <ProviderIcon icon={provider.icon} name={provider.name} size={32} />
            <div className="min-w-0">
              <SheetTitle className="truncate">{provider.name}</SheetTitle>
              <SheetDescription className="truncate font-mono">
                {provider.baseUrl}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {/* 摘要：三個最常問的問題 */}
          <div className="grid grid-cols-3 gap-2">
            <Summary
              label={t("globalProviders.detail.using", {
                defaultValue: "使用中",
              })}
              value={String(agentsUsing.length)}
              tone={agentsUsing.length > 0 ? "success" : "muted"}
            />
            <Summary
              label={t("globalProviders.detail.inStack", {
                defaultValue: "聚合中",
              })}
              value={String(inStack.length)}
              tone={inStack.length > 0 ? "info" : "muted"}
            />
            <Summary
              label={t("globalProviders.detail.outOfSync", {
                defaultValue: "未同步",
              })}
              value={String(outOfSync.length)}
              tone={outOfSync.length > 0 ? "warning" : "success"}
            />
          </div>

          {/* 身分與憑證 */}
          <section className="space-y-1.5">
            <h3 className="m-0 text-caption font-semibold text-fg-2">
              {t("globalProviders.detail.identity", {
                defaultValue: "識別與憑證",
              })}
            </h3>
            <Fact
              label={t("globalProviders.detail.universalId", {
                defaultValue: "全域 id",
              })}
              value={provider.id}
              mono
              onCopy={() => void copy(provider.id)}
            />
            <Fact
              label={t("globalProviders.detail.apiKey", {
                defaultValue: "共用憑證",
              })}
              value={masked(provider.apiKey)}
              mono
            />
            <Fact
              label={t("globalProviders.detail.lastSynced", {
                defaultValue: "上次成功同步",
              })}
              value={formatTime(status?.lastSyncedAt)}
            />
          </section>

          {/* 逐 Agent 狀態 */}
          <section className="space-y-2">
            <h3 className="m-0 text-caption font-semibold text-fg-2">
              {t("globalProviders.detail.perAgent", {
                defaultValue: "各 Agent 的落地狀態",
              })}
            </h3>
            <div className="divide-y divide-border overflow-hidden rounded-panel border border-border">
              {SHARED_AGENTS.map((agent) => {
                const child = childFor(status, agent.id);
                const enabled = provider.apps[agent.id];
                return (
                  <div key={agent.id} className="space-y-1.5 px-3 py-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <ProviderIcon
                        icon={agent.icon}
                        name={agent.name}
                        size={18}
                      />
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-fg-1">
                        {agent.name}
                      </span>
                      {!enabled ? (
                        <StateBadge tone="muted">
                          {t("globalProviders.detail.notAssigned", {
                            defaultValue: "未分配",
                          })}
                        </StateBadge>
                      ) : !child?.exists ? (
                        <StateBadge tone="warning">
                          {t("globalProviders.detail.notPublished", {
                            defaultValue: "尚未發布",
                          })}
                        </StateBadge>
                      ) : (
                        <>
                          <StateBadge tone="success">
                            {t("globalProviders.detail.published", {
                              defaultValue: "已發布",
                            })}
                          </StateBadge>
                          {child.inUse && (
                            <StateBadge tone="success">
                              {t("authCenter.providers.agentState.inUse", {
                                defaultValue: "使用中",
                              })}
                            </StateBadge>
                          )}
                          {child.inStack && (
                            <StateBadge tone="info">
                              {t("authCenter.providers.agentState.inStack", {
                                defaultValue: "聚合中",
                              })}
                            </StateBadge>
                          )}
                          {child.inFailoverQueue && (
                            <StateBadge tone="info">
                              {t("authCenter.providers.agentState.inFailover", {
                                defaultValue: "故障轉移",
                              })}
                            </StateBadge>
                          )}
                          {child.inSync === false && (
                            <StateBadge tone="warning">
                              {t("authCenter.providers.agentState.outOfSync", {
                                defaultValue: "未同步",
                              })}
                            </StateBadge>
                          )}
                        </>
                      )}
                      {onOpenAgent && enabled && (
                        <Button
                          type="button"
                          variant="quiet"
                          size="icon-compact"
                          aria-label={t("globalProviders.detail.openAgent", {
                            defaultValue: "前往 {{name}}",
                            name: agent.name,
                          })}
                          onClick={() => onOpenAgent(agent.id)}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    {child?.exists && (
                      <div className="space-y-1 ps-6">
                        <Fact
                          label={t("globalProviders.detail.childId", {
                            defaultValue: "子卡 id",
                          })}
                          value={child.childId}
                          mono
                          onCopy={() => void copy(child.childId)}
                          compact
                        />
                        <Fact
                          label={t("globalProviders.detail.livePath", {
                            defaultValue: "live 檔",
                          })}
                          value={child.livePath}
                          mono
                          compact
                        />
                        {child.inSync === false &&
                          child.changedFields.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                              <AlertTriangle className="h-3 w-3 shrink-0 text-warning-text" />
                              <span className="text-caption text-warning-text">
                                {t("globalProviders.detail.changedFields", {
                                  defaultValue: "同步會覆蓋：",
                                })}
                              </span>
                              {child.changedFields.map((field) => (
                                <code
                                  key={field}
                                  className="rounded bg-warning-soft px-1.5 py-0.5 font-mono text-badge text-warning-text"
                                >
                                  {field}
                                </code>
                              ))}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {inQueue.length > 0 && (
            <p className="m-0 rounded-control bg-subtle/60 px-3 py-2 text-caption text-fg-2">
              {t("globalProviders.detail.queueHint", {
                defaultValue:
                  "也用在故障轉移佇列：{{agents}}。刪除前請先在該 Agent 移出佇列。",
                agents: inQueue.map((agent) => agent.name).join("、"),
              })}
            </p>
          )}

          {agentsUsing.length > 0 && (
            <p className="m-0 flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-caption text-warning-text">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t("globalProviders.detail.inUseHint", {
                  defaultValue:
                    "{{agents}} 正在使用這家，後端會拒絕刪除；請先在該 Agent 切換到其他供應商。",
                  agents: agentsUsing.map((agent) => agent.name).join("、"),
                })}
              </span>
            </p>
          )}
        </SheetBody>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="quiet"
            size="compact"
            onClick={() => onAssign(provider)}
          >
            <UsersRound className="h-3.5 w-3.5" />
            {t("authCenter.providers.assign", { defaultValue: "分配" })}
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            onClick={() => onEdit(provider)}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("common.edit", { defaultValue: "編輯" })}
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            className="text-danger-text"
            disabled={saving || agentsUsing.length > 0}
            title={
              agentsUsing.length > 0
                ? t("globalProviders.detail.deleteBlocked", {
                    defaultValue: "有 Agent 正在使用，無法刪除",
                  })
                : undefined
            }
            onClick={() => onDelete(provider)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("common.delete", { defaultValue: "刪除" })}
          </Button>
          <Button
            type="button"
            variant="default"
            size="compact"
            disabled={syncing}
            onClick={() => onSync(provider)}
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : outOfSync.length > 0 ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {outOfSync.length > 0
              ? t("globalProviders.detail.syncNowWithChanges", {
                  defaultValue: "同步（{{count}} 個未同步）",
                  count: outOfSync.length,
                })
              : t("globalProviders.detail.syncNow", {
                  defaultValue: "同步",
                })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "info" | "muted";
}) {
  const valueClass =
    tone === "success"
      ? "text-success-text"
      : tone === "warning"
        ? "text-warning-text"
        : tone === "info"
          ? "text-stack-text"
          : "text-fg-2";
  return (
    <div className="rounded-control border border-border bg-surface px-2.5 py-2">
      <div className="truncate text-caption text-fg-3">{label}</div>
      <div className={`mt-0.5 text-strong font-semibold ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
  onCopy,
  compact,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${compact ? "text-caption" : "text-body"}`}
    >
      <span className="shrink-0 text-caption text-fg-3">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate ${mono ? "font-mono text-caption" : ""} text-fg-1`}
        title={value}
      >
        {value}
      </span>
      {onCopy && (
        <Button
          type="button"
          variant="quiet"
          size="icon-compact"
          aria-label={`${label}: ${value}`}
          onClick={onCopy}
        >
          <Copy className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
