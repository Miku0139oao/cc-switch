import { useMemo } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Info,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import type { ProxyStack, StackFallbackTarget } from "@/types/proxy";
import type { AppId } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StackRouteDiagnosticsProps {
  app: AppId;
  stack: ProxyStack | undefined;
  providers: Record<string, Provider>;
}

export interface StackDiagnosticRoute {
  clientModelId: string;
  displayName: string;
  providerId: string;
  providerName: string;
  upstreamModel: string;
  fallbacks: (StackFallbackTarget & { providerName: string })[];
  customFallback: boolean;
}

export function buildStackDiagnosticRoutes(
  stack: ProxyStack | undefined,
  providers: Record<string, Provider>,
): StackDiagnosticRoute[] {
  if (!stack) return [];

  const routes = new Map<string, StackDiagnosticRoute>();
  for (const member of stack.members ?? []) {
    const providerName =
      providers[member.providerId]?.name ?? member.providerId;
    for (const id of member.modelIds ?? []) {
      if (routes.has(id)) continue;
      const model = (member.models ?? []).find(
        (candidate) => candidate.id === id,
      );
      const configured = stack.fallbacks?.[id] ?? [];
      const effective = stack.effectiveFallbacks?.[id] ?? configured;
      routes.set(id, {
        clientModelId: id,
        displayName: model?.displayName ?? model?.upstreamModel ?? id,
        providerId: member.providerId,
        providerName,
        upstreamModel: model?.upstreamModel ?? id,
        fallbacks: effective.map((target) => ({
          ...target,
          providerName: providers[target.providerId]?.name ?? target.providerId,
        })),
        customFallback: configured.length > 0,
      });
    }
  }
  return [...routes.values()];
}

function buildDiagnosticText(
  app: AppId,
  stack: ProxyStack,
  providers: Record<string, Provider>,
  routes: StackDiagnosticRoute[],
): string {
  const defaultProvider = stack.members?.find((member) => member.route);
  const defaultName = defaultProvider
    ? (providers[defaultProvider.providerId]?.name ??
      defaultProvider.providerId)
    : "-";
  return [
    `CC Switch aggregation diagnostics`,
    `app=${app}`,
    `active=${stack.active}`,
    `default=${defaultName}`,
    `balance=${stack.balanceStrategy}`,
    `sticky_sessions=${stack.balancedSessionCount ?? 0}`,
    ...routes.flatMap((route) => [
      "",
      `model=${route.clientModelId}`,
      `display=${route.displayName}`,
      `primary=${route.providerName}`,
      `upstream=${route.upstreamModel}`,
      `fallback_mode=${route.customFallback ? "custom" : "automatic"}`,
      `fallbacks=${
        route.fallbacks
          .map((target) => `${target.providerName}:${target.upstreamModel}`)
          .join(" -> ") || "none"
      }`,
    ]),
  ].join("\n");
}

export function StackRouteDiagnostics({
  app,
  stack,
  providers,
}: StackRouteDiagnosticsProps) {
  const { t } = useTranslation();
  const routes = useMemo(
    () => buildStackDiagnosticRoutes(stack, providers),
    [providers, stack],
  );

  if (!stack || (stack.members?.length ?? 0) === 0) return null;

  const defaultMember = stack.members?.find((member) => member.route);
  const defaultName = defaultMember
    ? (providers[defaultMember.providerId]?.name ?? defaultMember.providerId)
    : t("mode.noProvider");

  const copyDiagnostics = async () => {
    try {
      await copyText(buildDiagnosticText(app, stack, providers, routes));
      toast.success(
        t("mode.diagnostics.copied", {
          defaultValue: "聚合診斷已複製",
        }),
      );
    } catch {
      toast.error(
        t("mode.diagnostics.copyFailed", {
          defaultValue: "無法複製聚合診斷",
        }),
      );
    }
  };

  return (
    <section className="mb-4 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 shrink-0 text-stack-text" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-body font-semibold text-fg-1">
            {t("mode.diagnostics.title", {
              defaultValue: "聚合路由診斷",
            })}
          </h2>
          <p className="m-0 text-caption text-fg-2">
            {t("mode.diagnostics.description", {
              defaultValue:
                "核對客戶端看到的模型 ID、實際首選供應商與備援目標。",
            })}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium",
            stack.active
              ? "bg-success-soft text-success-text"
              : "bg-warning-soft text-warning-text",
          )}
        >
          {stack.active ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5" />
          )}
          {stack.active
            ? t("mode.diagnostics.active", { defaultValue: "已發佈" })
            : t("mode.diagnostics.inactive", {
                defaultValue: "目前未啟用聚合",
              })}
        </span>
        <Button
          type="button"
          variant="quiet"
          size="compact"
          onClick={() => void copyDiagnostics()}
        >
          <Clipboard className="h-3.5 w-3.5" />
          {t("mode.diagnostics.copy", { defaultValue: "複製診斷" })}
        </Button>
      </div>

      {!stack.active && (
        <div className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-caption text-warning-text">
          {t("mode.diagnostics.inactiveHint", {
            defaultValue:
              "這份名單目前只保存設定，尚未發佈到客戶端。CLI 的 /model 仍可能顯示原生模型，請先切換到聚合模式。",
          })}
        </div>
      )}

      <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
        <Metric
          label={t("mode.diagnostics.defaultRoute", {
            defaultValue: "目前預設",
          })}
          value={defaultName}
        />
        <Metric
          label={t("mode.diagnostics.publishedModels", {
            defaultValue: "已發佈模型",
          })}
          value={String(routes.length)}
        />
        <Metric
          label={t("mode.diagnostics.strategy", {
            defaultValue: "平衡策略",
          })}
          value={t(`mode.balance.strategies.${stack.balanceStrategy}.label`)}
        />
        <Metric
          label={t("mode.diagnostics.stickySessions", {
            defaultValue: "黏著工作階段",
          })}
          value={String(stack.balancedSessionCount ?? 0)}
        />
      </div>

      {app === "claude" && (
        <div className="flex items-start gap-2 border-b border-border bg-subtle/40 px-4 py-2.5 text-caption text-fg-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-direct-text" />
          <span>
            {t("mode.diagnostics.claudeHarnessHint", {
              defaultValue:
                "Claude Code 系統提示中的 Opus、Sonnet 或 Fable 是 harness 顯示名稱，不代表實際 backend。請以 ccs-* 模型 ID 和下方「上游模型」為準。",
            })}
          </span>
        </div>
      )}

      {routes.length === 0 ? (
        <div className="px-4 py-6 text-center text-caption text-fg-2">
          {t("mode.diagnostics.noModels", {
            defaultValue:
              "目前沒有可診斷的聚合模型。確認已加入成員，且該成員有可發佈的模型。",
          })}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {routes.map((route) => (
            <div key={route.clientModelId} className="px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-fg-1">
                    {route.displayName}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <code
                      className="min-w-0 truncate rounded bg-subtle px-1.5 py-0.5 font-mono text-caption text-fg-2"
                      title={route.clientModelId}
                    >
                      {route.clientModelId}
                    </code>
                  </div>
                </div>
                <span className="inline-flex h-6 items-center rounded-full bg-stack-soft px-2 text-caption font-medium text-stack-text">
                  {route.providerName}
                </span>
                <span className="inline-flex h-6 items-center rounded-full border border-border-strong px-2 font-mono text-caption text-fg-2">
                  {route.upstreamModel}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-caption">
                <span className="font-medium text-fg-3">
                  {t("mode.diagnostics.fallbackPath", {
                    defaultValue: "失敗後",
                  })}
                </span>
                {route.fallbacks.length === 0 ? (
                  <span className="text-fg-3">{t("mode.fallback.none")}</span>
                ) : (
                  route.fallbacks.map((target, index) => (
                    <span
                      key={`${target.providerId}-${target.upstreamModel}-${index}`}
                      className="inline-flex items-center gap-1.5"
                    >
                      {index > 0 && (
                        <ArrowRight className="h-3 w-3 text-fg-3" />
                      )}
                      <span className="inline-flex h-6 items-center rounded-full border border-border bg-subtle/50 px-2 text-fg-2">
                        {target.providerName}
                        <span className="mx-1 text-fg-3">/</span>
                        <span className="font-mono">
                          {target.upstreamModel}
                        </span>
                      </span>
                    </span>
                  ))
                )}
                <span className="ms-auto rounded-full border border-border px-2 py-0.5 text-fg-3">
                  {route.customFallback
                    ? t("mode.fallback.customMode")
                    : t("mode.fallback.automaticMode")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-e border-border px-4 py-2.5 last:border-e-0">
      <div className="text-caption text-fg-3">{label}</div>
      <div className="mt-0.5 truncate text-body font-medium text-fg-1">
        {value}
      </div>
    </div>
  );
}
