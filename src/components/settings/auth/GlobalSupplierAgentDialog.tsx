import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  UniversalProvider,
  UniversalProviderApps,
  UniversalProviderModels,
  UniversalProviderStatus,
} from "@/types";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SHARED_AGENTS, type SharedAgentId } from "./sharedAgents";

interface GlobalSupplierAgentDialogProps {
  provider: UniversalProvider | null;
  status?: UniversalProviderStatus | null;
  saving: boolean;
  onClose: () => void;
  onSave: (provider: UniversalProvider) => void;
}

const EMPTY_APPS: UniversalProviderApps = {
  claude: false,
  codex: false,
  gemini: false,
};

function modelFor(
  models: UniversalProviderModels,
  agent: SharedAgentId,
): string {
  return models[agent]?.model?.trim() ?? "";
}

export function GlobalSupplierAgentDialog({
  provider,
  status,
  saving,
  onClose,
  onSave,
}: GlobalSupplierAgentDialogProps) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<UniversalProviderApps>(EMPTY_APPS);
  const [models, setModels] = useState<UniversalProviderModels>({});

  useEffect(() => {
    if (!provider) return;
    setApps({ ...provider.apps });
    setModels(structuredClone(provider.models ?? {}));
  }, [provider]);

  const missingModels = useMemo(
    () =>
      SHARED_AGENTS.filter(
        (agent) => apps[agent.id] && !modelFor(models, agent.id),
      ).map((agent) => agent.name),
    [apps, models],
  );

  if (!provider) return null;

  const setAgentEnabled = (agent: SharedAgentId, enabled: boolean) => {
    setApps((current) => ({ ...current, [agent]: enabled }));
  };

  const setAgentModel = (agent: SharedAgentId, model: string) => {
    setModels((current) => ({
      ...current,
      [agent]: {
        ...current[agent],
        model,
      },
    }));
  };

  const save = () => {
    const nextModels: UniversalProviderModels = {
      ...models,
    };
    for (const agent of SHARED_AGENTS) {
      if (!apps[agent.id]) continue;
      nextModels[agent.id] = {
        ...nextModels[agent.id],
        model: modelFor(models, agent.id),
      };
    }
    onSave({
      ...provider,
      apps,
      models: nextModels,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[620px]">
        <DialogTitle>
          {t("authCenter.providers.assignTitle", {
            defaultValue: "分配 {{name}} 給 Agent",
            name: provider.name,
          })}
        </DialogTitle>
        <DialogDescription>
          {t("authCenter.providers.assignDescription", {
            defaultValue:
              "勾選要看到這家供應商的 Agent。這只會建立可選用的 provider，不會切換任何 Agent 目前使用中的供應商。",
          })}
        </DialogDescription>

        <div className="mt-4 space-y-2">
          {SHARED_AGENTS.map((agent) => {
            const enabled = apps[agent.id];
            const model = modelFor(models, agent.id);
            const agentStatus = status?.children.find(
              (child) => child.app === agent.id,
            );
            const stateLabels = agentStatus
              ? [
                  agentStatus.inUse
                    ? t("authCenter.providers.agentState.inUse", {
                        defaultValue: "使用中",
                      })
                    : null,
                  agentStatus.inStack
                    ? t("authCenter.providers.agentState.inStack", {
                        defaultValue: "聚合中",
                      })
                    : null,
                  agentStatus.inFailoverQueue
                    ? t("authCenter.providers.agentState.inFailover", {
                        defaultValue: "故障轉移",
                      })
                    : null,
                  agentStatus.exists && agentStatus.inSync === false
                    ? t("authCenter.providers.agentState.outOfSync", {
                        defaultValue: "未同步",
                      })
                    : null,
                ].filter(Boolean)
              : [];
            return (
              <div
                key={agent.id}
                className="overflow-hidden rounded-control border border-border bg-surface"
              >
                <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: agent.color }}
                  />
                  <ProviderIcon icon={agent.icon} name={agent.name} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium text-fg-1">
                      {agent.name}
                    </div>
                    <div className="truncate text-caption text-fg-3">
                      {stateLabels.length > 0
                        ? stateLabels.join(" · ")
                        : agentStatus?.exists
                          ? t("authCenter.providers.agentState.available", {
                              defaultValue: "可選用",
                            })
                          : provider.apps[agent.id]
                            ? t(
                                "authCenter.providers.agentCurrentlyAvailable",
                                {
                                  defaultValue: "目前已可用",
                                },
                              )
                            : t("authCenter.providers.agentNotAssigned", {
                                defaultValue: "尚未分配",
                              })}
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      setAgentEnabled(agent.id, checked)
                    }
                    aria-label={t("authCenter.providers.agentToggle", {
                      defaultValue: "提供給 {{name}}",
                      name: agent.name,
                    })}
                  />
                </div>
                {enabled && (
                  <div className="border-t border-border bg-subtle/25 px-3 py-2.5">
                    <Label
                      htmlFor={`agent-model-${provider.id}-${agent.id}`}
                      className="text-caption"
                    >
                      {t("authCenter.providers.agentModel", {
                        defaultValue: "{{name}} 主模型",
                        name: agent.name,
                      })}
                    </Label>
                    <Input
                      id={`agent-model-${provider.id}-${agent.id}`}
                      value={model}
                      onChange={(event) =>
                        setAgentModel(agent.id, event.target.value)
                      }
                      placeholder={t(
                        `authCenter.providers.agentModelPlaceholder.${agent.id}`,
                        {
                          defaultValue:
                            agent.id === "claude"
                              ? "例如 deepseek-v4-pro"
                              : agent.id === "codex"
                                ? "例如 deepseek-v4-flash"
                                : "例如 gemini-2.5-pro",
                        },
                      )}
                      className="mt-1"
                    />
                    {agent.id === "claude" && (
                      <p className="m-0 mt-1 text-caption text-fg-3">
                        {t("authCenter.providers.claudeModelHint", {
                          defaultValue:
                            "Haiku、Sonnet、Opus 與 Fable 若未另外設定，會沿用這個主模型。",
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {missingModels.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption text-warning-text">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {t("authCenter.providers.agentModelRequired", {
                defaultValue:
                  "請先填入 {{agents}} 的模型，避免同步後產生不可用的 provider。",
                agents: missingModels.join("、"),
              })}
            </span>
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-control bg-subtle/60 px-3 py-2 text-caption text-fg-2">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-text" />
          <span>
            {t("authCenter.providers.assignHint", {
              defaultValue:
                "儲存後會同步到所選 Agent。進階模型檔位仍可在「編輯」中分別調整。",
            })}
          </span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={saving || missingModels.length > 0}
            onClick={save}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving
              ? t("authCenter.providers.saving")
              : t("authCenter.providers.assignApply", {
                  defaultValue: "套用並同步",
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
