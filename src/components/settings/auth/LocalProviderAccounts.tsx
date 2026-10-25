import { ExternalLink, KeyRound, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { APP_IDS } from "@/config/appConfig";
import { isOAuthProviderType } from "@/config/constants";
import { providersQueryOptions } from "@/lib/query/queries";
import { extractProviderBaseUrl } from "@/utils/providerConfigUtils";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface LocalProviderRow {
  appId: AppId;
  provider: Provider;
  current: boolean;
}

interface LocalProviderAccountsProps {
  rows: LocalProviderRow[];
  isLoading?: boolean;
  onOpenApp?: (appId: AppId) => void;
}

function providerEndpoint(provider: Provider): string {
  const raw = extractProviderBaseUrl(provider.settingsConfig);
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function isManagedOAuthProvider(provider: Provider): boolean {
  const providerType = provider.meta?.providerType;
  return (
    isOAuthProviderType(providerType) ||
    Boolean(provider.meta?.authBinding?.authProvider)
  );
}

export function LocalProviderAccounts({
  rows,
  isLoading = false,
  onOpenApp,
}: LocalProviderAccountsProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter(({ appId, provider }) => {
      const endpoint = providerEndpoint(provider);
      return [provider.name, appId, APP_DISPLAY_NAME[appId], endpoint]
        .join("\n")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [rows, search]);
  const visible = expanded ? filtered : filtered.slice(0, 6);

  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <KeyRound className="h-4 w-4 shrink-0 text-action" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-body font-semibold text-fg-1">
            {t("authCenter.providers.title", {
              defaultValue: "供应商",
            })}
          </h2>
          <p className="m-0 text-caption text-fg-2">
            {t("authCenter.providers.description", {
              defaultValue: "已在各 App 使用的 API Key 与官方供应商",
            })}
          </p>
        </div>
        <span className="rounded-full bg-subtle px-2 py-0.5 text-caption text-fg-2">
          {rows.length}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="border-b border-border px-4 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 ps-8"
              placeholder={t("authCenter.providers.search", {
                defaultValue: "搜索供应商、App 或地址",
              })}
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="px-4 py-5 text-caption text-fg-2">
          {t("authCenter.statusLoading", { defaultValue: "正在加载账号…" })}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-5 text-caption text-fg-2">
          {rows.length === 0
            ? t("authCenter.providers.empty", {
                defaultValue: "还没有 API Key 或官方供应商。",
              })
            : t("authCenter.providers.noMatch", {
                defaultValue: "没有符合搜索条件的供应商。",
              })}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visible.map(({ appId, provider, current }) => {
            const endpoint = providerEndpoint(provider);
            return (
              <div
                key={`${appId}:${provider.id}`}
                className="flex min-w-0 items-center gap-3 px-4 py-2.5 hover:bg-subtle/35"
              >
                <ProviderIcon
                  icon={provider.icon}
                  name={provider.name}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-body font-medium text-fg-1">
                      {provider.name}
                    </span>
                    {current && (
                      <span className="shrink-0 rounded-full bg-success-soft px-1.5 py-0.5 text-badge font-semibold text-success-text">
                        {t("authCenter.default", { defaultValue: "默认" })}
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-caption text-fg-3">
                    <span className="shrink-0">{APP_DISPLAY_NAME[appId]}</span>
                    {endpoint && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{endpoint}</span>
                      </>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "hidden shrink-0 rounded-full px-2 py-0.5 text-badge font-semibold sm:inline-flex",
                    provider.category === "official"
                      ? "bg-action-soft text-action-text"
                      : "bg-subtle text-fg-2",
                  )}
                >
                  {provider.category === "official"
                    ? t("authCenter.providers.official", {
                        defaultValue: "官方",
                      })
                    : t("authCenter.providers.apiKey", {
                        defaultValue: "API Key",
                      })}
                </span>
                {onOpenApp && (
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon-compact"
                    aria-label={t("authCenter.providers.manageInApp", {
                      defaultValue: "在 {{app}} 中管理",
                      app: APP_DISPLAY_NAME[appId],
                    })}
                    onClick={() => onOpenApp(appId)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
          {filtered.length > 6 && (
            <div className="px-4 py-2 text-center">
              <Button
                type="button"
                variant="quiet"
                size="compact"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? t("authCenter.providers.showLess", {
                      defaultValue: "收起",
                    })
                  : t("authCenter.providers.showAll", {
                      defaultValue: "显示全部 {{count}} 个",
                      count: filtered.length,
                    })}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface LocalProviderAccountsSectionProps {
  onOpenApp?: (appId: AppId) => void;
}

export function LocalProviderAccountsSection({
  onOpenApp,
}: LocalProviderAccountsSectionProps) {
  const queries = useQueries({
    queries: APP_IDS.map((appId) => providersQueryOptions(appId)),
  });
  const rows = APP_IDS.flatMap((appId, index) => {
    const data = queries[index]?.data;
    if (!data) return [];
    return Object.values(data.providers)
      .filter((provider) => !isManagedOAuthProvider(provider))
      .map((provider) => ({
        appId,
        provider,
        current: provider.id === data.currentProviderId,
      }));
  });

  return (
    <LocalProviderAccounts
      rows={rows}
      isLoading={queries.some((query) => query.isPending)}
      onOpenApp={onOpenApp}
    />
  );
}
