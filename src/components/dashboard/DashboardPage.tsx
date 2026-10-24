import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CircleAlert,
  LayoutDashboard,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { toast } from "@/lib/toast";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import type { AppMode } from "@/types/proxy";
import {
  isModeAppId,
  isStackAppId,
  orderAppIds,
} from "@/config/appConfig";
import { providersQueryOptions, useSettingsQuery } from "@/lib/query";
import {
  proxyKeys,
  useProxyStatusQuery,
} from "@/lib/query/proxy";
import { failoverApi } from "@/lib/api/failover";
import { proxyApi } from "@/lib/api/proxy";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { APP_DISPLAY_NAME, AppGlyph } from "@/components/shell/AppGlyph";
import UsageFooter from "@/components/UsageFooter";
import SubscriptionQuotaFooter from "@/components/SubscriptionQuotaFooter";
import CodexOauthQuotaFooter from "@/components/CodexOauthQuotaFooter";
import { Button } from "@/components/ui/button";
import { DEFAULT_VISIBLE_APPS } from "@/config/appConfig";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<AppMode, string> = {
  direct: "direct",
  route: "route",
  stack: "stack",
};

function providerIsOfficial(provider: Provider | undefined): boolean {
  return provider?.category === "official";
}

function DashboardQuota({
  app,
  provider,
}: {
  app: AppId;
  provider: Provider | undefined;
}) {
  if (!provider) return null;
  if (
    app === "codex" &&
    (provider.meta?.providerType === "codex_oauth" ||
      provider.meta?.authBinding?.authProvider === "codex_oauth")
  ) {
    return (
      <CodexOauthQuotaFooter
        meta={provider.meta}
        inline
        isCurrent
        autoQueryInterval={5}
      />
    );
  }
  if (providerIsOfficial(provider)) {
    return (
      <SubscriptionQuotaFooter
        appId={app}
        inline
        isCurrent
        autoQueryInterval={5}
      />
    );
  }
  if (provider.meta?.usage_script?.enabled) {
    return (
      <UsageFooter
        provider={provider}
        providerId={provider.id}
        appId={app}
        usageEnabled
        isCurrent
        inline
      />
    );
  }
  return null;
}

interface DashboardPageProps {
  onOpenApp: (app: AppId) => void;
}

export function DashboardPage({ onOpenApp }: DashboardPageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status } = useProxyStatusQuery();
  const { data: settings } = useSettingsQuery();
  const visibleApps = { ...DEFAULT_VISIBLE_APPS, ...settings?.visibleApps };
  const apps = useMemo(
    () => orderAppIds(settings?.appOrder).filter((app) => visibleApps[app]),
    [settings?.appOrder, settings?.visibleApps],
  );

  const modeQueries = useQueries({
    queries: apps.map((app) => ({
      queryKey: ["providers", app, "mode"] as const,
      queryFn: () => proxyApi.getAppMode(app),
      enabled: isModeAppId(app),
      staleTime: 10_000,
    })),
  });
  const stackQueries = useQueries({
    queries: apps.map((app) => ({
      queryKey: ["providers", app, "stack"] as const,
      queryFn: () => proxyApi.getProxyStack(app),
      enabled: isStackAppId(app),
      staleTime: 10_000,
    })),
  });
  const providerResults = useQueries({
    queries: apps.map((app) => ({
      ...providersQueryOptions(app),
      staleTime: 10_000,
    })),
  });

  const activeProviderIds = apps.map((_app, index) => {
    const mode = modeQueries[index]?.data;
    const providers = providerResults[index]?.data;
    if (mode?.mode && mode.mode !== "direct") {
      return mode.routeProviderId ?? providers?.currentProviderId ?? null;
    }
    return (
      mode?.directProviderId ??
      providers?.currentProviderId ??
      null
    );
  });
  const healthQueries = useQueries({
    queries: apps.map((app, index) => ({
      queryKey: ["providerHealth", app, activeProviderIds[index]] as const,
      queryFn: () =>
        failoverApi.getProviderHealth(
          activeProviderIds[index] as string,
          app,
        ),
      enabled:
        status?.running === true &&
        isModeAppId(app) &&
        Boolean(activeProviderIds[index]),
      staleTime: 10_000,
    })),
  });

  const startService = async () => {
    try {
      await proxyApi.startProxyServer();
      await queryClient.invalidateQueries({ queryKey: proxyKeys.status });
    } catch (error) {
      toast.error(t("dashboard.startFailed"), {
        description: String(error),
      });
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["usage"] }),
      queryClient.invalidateQueries({ queryKey: ["providers"] }),
      queryClient.invalidateQueries({ queryKey: proxyKeys.status }),
      queryClient.invalidateQueries({ queryKey: ["providerHealth"] }),
    ]);
    toast.success(t("dashboard.refreshed"));
  };

  return (
    <>
      <AppPageHeader
        icon={<LayoutDashboard className="h-5 w-5" strokeWidth={1.6} />}
        title={t("nav.dashboard")}
        actions={
          <>
            {!status?.running && (
              <Button variant="neutral" onClick={() => void startService()}>
                <Play className="h-3.5 w-3.5" />
                {t("dashboard.startService")}
              </Button>
            )}
            <Button variant="quiet" onClick={() => void refreshAll()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("dashboard.refreshAll")}
            </Button>
          </>
        }
      />

      <div
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto scroll-stable"
      >
        <div className="grid grid-cols-4 border-b border-border bg-surface px-6">
          {[
            {
              icon: Activity,
              label: t("dashboard.service"),
              value: status?.running
                ? t("dashboard.running")
                : t("dashboard.stopped"),
              tone: status?.running ? "text-success-text" : "text-fg-2",
            },
            {
              icon: Waypoints,
              label: t("dashboard.activeConnections"),
              value: String(status?.active_connections ?? 0),
            },
            {
              icon: ShieldCheck,
              label: t("dashboard.totalRequests"),
              value: (status?.total_requests ?? 0).toLocaleString(),
            },
            {
              icon: Route,
              label: t("dashboard.fallbacks"),
              value: String(status?.failover_count ?? 0),
            },
          ].map((metric) => (
            <div
              key={metric.label}
              className="flex min-w-0 items-center gap-3 border-e border-border px-4 py-3 last:border-e-0"
            >
              <metric.icon className="h-4 w-4 shrink-0 text-fg-3" />
              <div className="min-w-0">
                <div className="text-caption text-fg-2">{metric.label}</div>
                <div
                  className={cn(
                    "truncate text-strong font-semibold tabular-nums",
                    metric.tone ?? "text-fg-1",
                  )}
                >
                  {metric.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[minmax(150px,1fr)_86px_minmax(150px,1.1fr)_minmax(180px,1.35fr)_minmax(190px,1.5fr)_64px] gap-3 border-b border-border bg-subtle/60 px-6 py-2 text-caption font-semibold text-fg-2">
              <span>{t("dashboard.agent")}</span>
              <span>{t("dashboard.mode")}</span>
              <span>{t("dashboard.provider")}</span>
              <span>{t("dashboard.routeState")}</span>
              <span>{t("dashboard.quota")}</span>
              <span />
            </div>
            <div className="divide-y divide-border">
              {apps.map((app, index) => {
                const providerData = providerResults[index]?.data;
                const provider =
                  providerData?.providers[activeProviderIds[index] ?? ""];
                const mode = modeQueries[index]?.data;
                const effectiveMode: AppMode =
                  mode?.mode === "route" || mode?.mode === "stack"
                    ? mode.mode
                    : "direct";
                const stack = stackQueries[index]?.data;
                const health = healthQueries[index]?.data;
                const fallbackCount = Object.values(
                  stack?.fallbacks ?? {},
                ).reduce((sum, chain) => sum + chain.length, 0);
                const routeState =
                  effectiveMode === "route"
                    ? t("dashboard.routeQueue", {
                        count: mode ? 1 : 0,
                      })
                    : effectiveMode === "stack"
                      ? t("dashboard.stackState", {
                          members: stack?.members.length ?? 0,
                          fallbacks: fallbackCount,
                        })
                      : t("dashboard.directState");
                return (
                  <div
                    key={app}
                    className="grid grid-cols-[minmax(150px,1fr)_86px_minmax(150px,1.1fr)_minmax(180px,1.35fr)_minmax(190px,1.5fr)_64px] items-center gap-3 px-6 py-2.5 hover:bg-subtle/40"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 text-start"
                      onClick={() => onOpenApp(app)}
                    >
                      <AppGlyph app={app} size={18} />
                      <span className="truncate text-body font-medium text-fg-1">
                        {APP_DISPLAY_NAME[app]}
                      </span>
                    </button>
                    <span
                      className={cn(
                        "inline-flex w-fit rounded-full px-2 py-0.5 text-badge font-semibold",
                        effectiveMode === "direct" &&
                          "bg-direct-soft text-direct-text",
                        effectiveMode === "route" &&
                          "bg-route-soft text-route-text",
                        effectiveMode === "stack" &&
                          "bg-stack-soft text-stack-text",
                      )}
                    >
                      {t(`mode.names.${MODE_LABEL[effectiveMode]}`)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-body text-fg-1">
                        {provider?.name ?? t("mode.noProvider")}
                      </div>
                      {health && health.consecutive_failures > 0 && (
                        <div className="flex items-center gap-1 text-caption text-warning-text">
                          <CircleAlert className="h-3 w-3" />
                          {t("dashboard.degraded", {
                            count: health.consecutive_failures,
                          })}
                        </div>
                      )}
                    </div>
                    <span className="text-caption text-fg-2">
                      {routeState}
                    </span>
                    <div className="min-w-0 text-end text-caption">
                      <DashboardQuota app={app} provider={provider} />
                    </div>
                    <Button
                      variant="quiet"
                      size="compact"
                      onClick={() => onOpenApp(app)}
                    >
                      {t("dashboard.open")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
