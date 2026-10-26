import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MinusCircle,
  Trash2,
} from "lucide-react";
import type {
  UniversalChildStatus,
  UniversalProvider,
  UniversalProviderStatus,
} from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import { SHARED_AGENTS, type SharedAgentId } from "./sharedAgents";

export type GlobalProviderImpactMode = "sync" | "delete";

interface GlobalProviderImpactDialogProps {
  mode: GlobalProviderImpactMode;
  provider: UniversalProvider | null;
  status: UniversalProviderStatus | undefined;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

type Effect = "create" | "update" | "unchanged" | "delete" | "blocked";

interface AgentEffect {
  app: SharedAgentId;
  name: string;
  icon: string;
  effect: Effect;
  child?: UniversalChildStatus;
  reasons: string[];
}

function effectsFor(
  mode: GlobalProviderImpactMode,
  provider: UniversalProvider,
  status: UniversalProviderStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): AgentEffect[] {
  return SHARED_AGENTS.map((agent) => {
    const enabled = provider.apps[agent.id];
    const child = status?.children.find((entry) => entry.app === agent.id);
    const reasons: string[] = [];

    if (mode === "delete") {
      if (!child?.exists) {
        return {
          app: agent.id,
          name: agent.name,
          icon: agent.icon,
          effect: "unchanged" as const,
          child,
          reasons,
        };
      }
      if (child.inUse) {
        reasons.push(
          t("globalProviders.impact.reasonInUse", {
            defaultValue: "正在使用，後端會拒絕刪除",
          }),
        );
        return {
          app: agent.id,
          name: agent.name,
          icon: agent.icon,
          effect: "blocked" as const,
          child,
          reasons,
        };
      }
      reasons.push(
        t("globalProviders.impact.reasonCard", {
          defaultValue: "Agent 裡的子卡會消失",
        }),
      );
      if (child.inStack) {
        reasons.push(
          t("globalProviders.impact.reasonStack", {
            defaultValue: "會移出聚合名單；已發布的 ccs-* 模型 id 會失效",
          }),
        );
      }
      if (child.inFailoverQueue) {
        reasons.push(
          t("globalProviders.impact.reasonQueue", {
            defaultValue: "會移出故障轉移佇列",
          }),
        );
      }
      return {
        app: agent.id,
        name: agent.name,
        icon: agent.icon,
        effect: "delete" as const,
        child,
        reasons,
      };
    }

    if (!enabled) {
      if (!child?.exists) {
        return {
          app: agent.id,
          name: agent.name,
          icon: agent.icon,
          effect: "unchanged" as const,
          child,
          reasons,
        };
      }
      if (child.inUse) {
        reasons.push(
          t("globalProviders.impact.reasonDisableInUse", {
            defaultValue: "正在使用，不能關閉；後端會拒絕整次同步",
          }),
        );
        return {
          app: agent.id,
          name: agent.name,
          icon: agent.icon,
          effect: "blocked" as const,
          child,
          reasons,
        };
      }
      reasons.push(
        t("globalProviders.impact.reasonDisable", {
          defaultValue: "已關閉發布，子卡會被刪除",
        }),
      );
      return {
        app: agent.id,
        name: agent.name,
        icon: agent.icon,
        effect: "delete" as const,
        child,
        reasons,
      };
    }

    if (!child?.exists) {
      reasons.push(
        t("globalProviders.impact.reasonCreate", {
          defaultValue: "會建立可選用的子卡；不會切換目前供應商",
        }),
      );
      return {
        app: agent.id,
        name: agent.name,
        icon: agent.icon,
        effect: "create" as const,
        child,
        reasons,
      };
    }
    if (child.inSync === false) {
      reasons.push(
        t("globalProviders.impact.reasonUpdate", {
          defaultValue: "會覆蓋這些欄位：{{fields}}",
          fields: child.changedFields.join("、") || "—",
        }),
      );
      return {
        app: agent.id,
        name: agent.name,
        icon: agent.icon,
        effect: "update" as const,
        child,
        reasons,
      };
    }
    reasons.push(
      t("globalProviders.impact.reasonNoChange", {
        defaultValue: "已是最新，不會改動",
      }),
    );
    return {
      app: agent.id,
      name: agent.name,
      icon: agent.icon,
      effect: "unchanged" as const,
      child,
      reasons,
    };
  });
}

/**
 * 同步／刪除前先講清楚會發生什麼：哪個 Agent 建立、覆蓋哪些欄位、哪張卡消失、
 * 哪個聚合成員或佇列項目被移除。有阻擋項時確認鍵停用。
 */
export function GlobalProviderImpactDialog({
  mode,
  provider,
  status,
  busy,
  onClose,
  onConfirm,
}: GlobalProviderImpactDialogProps) {
  const { t } = useTranslation();
  if (!provider) return null;

  const effects = effectsFor(mode, provider, status, t);
  const blocked = effects.some((effect) => effect.effect === "blocked");
  const changes = effects.filter(
    (effect) => effect.effect !== "unchanged" && effect.effect !== "blocked",
  );

  const confirmLabel =
    mode === "delete"
      ? t("globalProviders.impact.confirmDelete", {
          defaultValue: "刪除全域供應商",
        })
      : t("globalProviders.impact.confirmSync", { defaultValue: "開始同步" });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>
          {mode === "delete"
            ? t("globalProviders.impact.deleteTitle", {
                defaultValue: "刪除「{{name}}」？",
                name: provider.name,
              })
            : t("globalProviders.impact.syncTitle", {
                defaultValue: "同步「{{name}}」到各 Agent？",
                name: provider.name,
              })}
        </DialogTitle>
        <DialogDescription>
          {mode === "delete"
            ? t("globalProviders.impact.deleteLead", {
                defaultValue:
                  "下面列的卡片與設定會被移除。這個動作不會自動切換任何 Agent 的供應商。",
              })
            : t("globalProviders.impact.syncLead", {
                defaultValue:
                  "只會建立或更新各 Agent 可選用的子卡，不會切換目前使用中的供應商。",
              })}
        </DialogDescription>

        <div className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border">
          {effects.map((effect) => (
            <EffectRow key={effect.app} effect={effect} />
          ))}
        </div>

        {blocked && (
          <p className="m-0 mt-3 flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-caption text-danger-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {mode === "delete"
                ? t("globalProviders.impact.blockedDelete", {
                    defaultValue:
                      "有 Agent 正在使用這家。請先在該 Agent 切換到其他供應商，再回來刪除。",
                  })
                : t("globalProviders.impact.blockedSync", {
                    defaultValue:
                      "有 Agent 正在使用、但發布開關被關掉了。請先在該 Agent 切換供應商，或把開關打開。",
                  })}
            </span>
          </p>
        )}

        {!blocked && changes.length === 0 && (
          <p className="m-0 mt-3 flex items-start gap-2 rounded-control bg-subtle px-3 py-2 text-caption text-fg-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-text" />
            <span>
              {mode === "delete"
                ? t("globalProviders.impact.nothingToDelete", {
                    defaultValue:
                      "各 Agent 都沒有這家的子卡，只會刪除全域設定。",
                  })
                : t("globalProviders.impact.nothingToSync", {
                    defaultValue: "各 Agent 都已是最新，不需要同步。",
                  })}
            </span>
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.cancel", { defaultValue: "取消" })}
          </Button>
          <Button
            type="button"
            variant={mode === "delete" ? "destructive" : "default"}
            disabled={busy || blocked}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : mode === "delete" ? (
              <Trash2 className="h-3.5 w-3.5" />
            ) : null}
            {busy
              ? t("globalProviders.impact.working", { defaultValue: "處理中…" })
              : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EffectRow({ effect }: { effect: AgentEffect }) {
  const { t } = useTranslation();
  const tone =
    effect.effect === "blocked"
      ? "bg-danger-soft text-danger-text"
      : effect.effect === "update" || effect.effect === "create"
        ? "bg-warning-soft text-warning-text"
        : effect.effect === "delete"
          ? "bg-danger-soft text-danger-text"
          : "bg-subtle text-fg-2";
  const label =
    effect.effect === "blocked"
      ? t("globalProviders.impact.effectBlocked", { defaultValue: "無法執行" })
      : effect.effect === "create"
        ? t("globalProviders.impact.effectCreate", { defaultValue: "建立" })
        : effect.effect === "update"
          ? t("globalProviders.impact.effectUpdate", { defaultValue: "更新" })
          : effect.effect === "delete"
            ? t("globalProviders.impact.effectDelete", { defaultValue: "刪除" })
            : t("globalProviders.impact.effectUnchanged", {
                defaultValue: "不變",
              });

  return (
    <div className="flex min-w-0 items-start gap-3 px-3 py-2.5">
      <ProviderIcon icon={effect.icon} name={effect.name} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-body font-medium text-fg-1">{effect.name}</span>
          <span
            className={`inline-flex h-5 items-center rounded-full px-2 text-badge font-medium ${tone}`}
          >
            {label}
          </span>
        </div>
        {effect.reasons.map((reason) => (
          <div
            key={reason}
            className="mt-0.5 flex items-start gap-1 text-caption text-fg-2"
          >
            {effect.effect === "unchanged" ? (
              <MinusCircle className="mt-0.5 h-3 w-3 shrink-0 text-fg-3" />
            ) : (
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-fg-3">
                ·
              </span>
            )}
            <span>{reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
