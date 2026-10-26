import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { AppId } from "@/lib/api";
import { providersQueryOptions } from "@/lib/query";
import { useStackFallbackEventsForRequest } from "@/lib/query/proxy";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRequestDetail } from "@/lib/query/usage";
import {
  getFreshInputTokens,
  isUnpricedUsage,
  type RequestLog,
} from "@/types/usage";
import { cn } from "@/lib/utils";
import { useMoneyFormat } from "@/hooks/useMoneyFormat";
import { extractErrorMessage } from "@/utils/errorUtils";
import {
  SPEED_ESTIMATE_MIN_OUTPUT_TOKENS,
  SPEED_MIN_OUTPUT_TOKENS,
  fmtInt,
  formatEstimatedTokensPerSecond,
  formatOutputTokensPerSecond,
  getLocaleFromLanguage,
  getResolvedLang,
  parseFiniteNumber,
} from "./format";
import { appDisplayName } from "./RequestLogTable";
import { getUsageProviderLabel } from "./providerLabel";

interface RequestDetailPanelProps {
  /** 要看的请求；null 时抽屉关闭 */
  requestId: string | null;
  onClose: () => void;
}

interface DetailRow {
  key: string;
  label: string;
  value: ReactNode;
  mono?: boolean;
  strong?: boolean;
  muted?: boolean;
  title?: string;
}

function DetailSection({ title, rows }: { title: string; rows: DetailRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-strong font-semibold text-fg-1">{title}</h3>
      {/* 卡片外框已经把一组框住，行与行靠间距分开，不再每行画线；只有「合计」上方留一道 */}
      <dl className="m-0 rounded-panel border border-border py-1.5">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "flex min-h-8 items-center gap-3 px-3.5 py-1",
              row.key === "total" && "mt-1.5 border-t border-border pt-2.5",
            )}
          >
            <dt className="shrink-0 text-caption text-fg-2">{row.label}</dt>
            <dd
              className={cn(
                "m-0 min-w-0 flex-1 truncate text-end tabular-nums",
                row.mono ? "font-mono text-caption" : "text-body",
                row.key === "requestId" && "selectable",
                row.strong && "font-semibold",
                row.muted ? "text-fg-3" : "text-fg-1",
              )}
              title={
                row.title ??
                (typeof row.value === "string" ? row.value : undefined)
              }
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function useDetailSections(request: RequestLog) {
  const { t, i18n } = useTranslation();
  const { money, moneyTitle } = useMoneyFormat();
  const usd = (value: string) => money(value, 4);
  const locale = getLocaleFromLanguage(getResolvedLang(i18n));
  const freshInput = getFreshInputTokens(request);
  const isCacheInclusive = request.inputTokens !== freshInput;
  const unpriced = isUnpricedUsage(request);
  const multiplier = parseFiniteNumber(request.costMultiplier);
  const isProxy = !request.dataSource || request.dataSource === "proxy";
  const tps = formatOutputTokensPerSecond(request);
  const estimatedTps = formatEstimatedTokensPerSecond(request);
  const latency = parseFiniteNumber(request.latencyMs);
  const firstToken = parseFiniteNumber(request.firstTokenMs);

  const basic: DetailRow[] = [
    {
      key: "time",
      label: t("usage.time"),
      value: new Date(request.createdAt * 1000).toLocaleString(locale),
    },
    {
      key: "app",
      label: t("usage.app"),
      value: appDisplayName(request.appType),
    },
    {
      key: "provider",
      label: t("usage.provider"),
      value: getUsageProviderLabel(request.providerName, t).shortLabel,
    },
    { key: "model", label: t("usage.model"), value: request.model, mono: true },
  ];
  // 会话日志的供应商就叫「会话日志」，ID 是内部的 _session：不再重复列「供应商 ID」和「来源」
  if (isProxy) {
    basic.splice(3, 0, {
      key: "providerId",
      label: t("usage.detail.providerId"),
      value: request.providerId,
      mono: true,
    });
  }
  if (request.requestModel && request.requestModel !== request.model) {
    basic.push({
      key: "requestModel",
      label: t("usage.requestModel"),
      value: request.requestModel,
      mono: true,
    });
  }
  if (request.pricingModel && request.pricingModel !== request.model) {
    basic.push({
      key: "pricingModel",
      label: t("usage.pricingModel"),
      value: request.pricingModel,
      mono: true,
    });
  }
  if (isProxy) {
    basic.push({
      key: "source",
      label: t("usage.detail.source"),
      value: t("usage.detail.sourceProxy", { code: request.statusCode }),
      title: request.dataSource ?? "proxy",
    });
  }
  basic.push({
    key: "requestId",
    label: t("usage.requestId"),
    value: request.requestId,
    mono: true,
  });

  const tokens: DetailRow[] = [
    {
      key: "fresh",
      label: t("usage.freshInput"),
      value: isCacheInclusive
        ? `${fmtInt(freshInput, locale)} (${t("usage.rawInputLabel")}: ${fmtInt(request.inputTokens, locale)})`
        : fmtInt(freshInput, locale),
    },
    {
      key: "output",
      label: t("usage.outputTokens"),
      value: fmtInt(request.outputTokens, locale),
    },
    {
      key: "read",
      label: t("usage.cacheReadTokens"),
      value: fmtInt(request.cacheReadTokens, locale),
    },
    {
      key: "write",
      label: t("usage.pricing.cacheWrite"),
      value: fmtInt(request.cacheCreationTokens, locale),
    },
  ];

  const cost: DetailRow[] = [
    {
      key: "input",
      label: t("usage.freshInput"),
      value: usd(request.inputCostUsd),
    },
    {
      key: "output",
      label: t("usage.outputTokens"),
      value: usd(request.outputCostUsd),
    },
    {
      key: "read",
      label: t("usage.cacheReadTokens"),
      value: usd(request.cacheReadCostUsd),
    },
    {
      key: "write",
      label: t("usage.pricing.cacheWrite"),
      value: usd(request.cacheCreationCostUsd),
    },
  ];
  if (multiplier != null && multiplier !== 1) {
    cost.push({
      key: "multiplier",
      label: t("usage.costMultiplier"),
      value: `×${request.costMultiplier}`,
    });
  }
  cost.push({
    key: "total",
    label:
      multiplier != null && multiplier !== 1
        ? `${t("usage.detail.total")} (${t("usage.withMultiplier")})`
        : t("usage.detail.total"),
    value: unpriced ? t("usage.unpriced") : usd(request.totalCostUsd),
    strong: !unpriced,
    muted: unpriced,
    title: unpriced ? undefined : moneyTitle(request.totalCostUsd, 6),
  });

  let performance: DetailRow[];
  if (!isProxy) {
    // 会话日志的耗时和首字是导入时按日志时间戳估的（耗时 0 = 没估出来）
    if (latency == null || latency <= 0) {
      performance = [
        {
          key: "speed",
          label: t("usage.speed"),
          value: t("usage.detail.noTimingSession"),
          muted: true,
        },
      ];
    } else {
      performance = [
        estimatedTps != null
          ? {
              key: "speed",
              label: t("usage.speed"),
              value: t("usage.speedEstimatedValue", { value: estimatedTps }),
            }
          : {
              key: "speed",
              label: t("usage.speed"),
              value:
                request.outputTokens < SPEED_ESTIMATE_MIN_OUTPUT_TOKENS
                  ? t("usage.detail.speedEstimateTooFew")
                  : "—",
              muted: true,
            },
        {
          key: "duration",
          label: t("usage.detail.durationEstimated"),
          value: `${(latency / 1000).toFixed(1)}s`,
          title: `${fmtInt(latency, locale)} ms`,
        },
      ];
      // 首字也是按时间戳推出来的；第一块不是思考、或 Codex 一开头就调工具时推不出来
      if (firstToken != null) {
        performance.splice(1, 0, {
          key: "ttft",
          label: t("usage.detail.firstTokenEstimated"),
          value: `${(firstToken / 1000).toFixed(1)}s`,
        });
      }
    }
  } else {
    const speedRow: DetailRow =
      tps != null
        ? {
            key: "speed",
            label: t("usage.speed"),
            value: t("usage.speedValue", { value: tps }),
          }
        : firstToken == null
          ? {
              key: "speed",
              label: t("usage.speed"),
              value: t("usage.detail.noFirstToken"),
              muted: true,
            }
          : request.outputTokens < SPEED_MIN_OUTPUT_TOKENS
            ? {
                key: "speed",
                label: t("usage.speed"),
                value: t("usage.detail.speedTooFew"),
                muted: true,
              }
            : {
                key: "speed",
                label: t("usage.speed"),
                value: "—",
                muted: true,
              };
    performance = [speedRow];
    if (firstToken != null) {
      performance.push({
        key: "ttft",
        label: t("usage.detail.firstToken"),
        value: `${(firstToken / 1000).toFixed(1)}s`,
      });
    }
    if (latency != null) {
      performance.push({
        key: "duration",
        label: t("usage.detail.duration"),
        value: `${(latency / 1000).toFixed(1)}s`,
        title: `${fmtInt(latency, locale)} ms`,
      });
    }
  }

  return { basic, tokens, cost, performance };
}

/**
 * 聚合請求的換家軌跡：後端 `stack_fallback_events` 用 session_id 關聯到這個請求。
 * 只有真的換過家才顯示；路由模式的一般請求不會有紀錄。
 */
function RoutingTrace({ request }: { request: RequestLog }) {
  const { t } = useTranslation();
  const { data: events } = useStackFallbackEventsForRequest(request.requestId);
  const appType = request.appType as AppId;
  // 共用主畫面的 providers 快取（key 和資料形狀都一致），避免同一個 key 被兩種
  // 不同形狀的 queryFn 覆蓋。
  const { data: providerData } = useQuery({
    ...providersQueryOptions(appType),
    enabled: Boolean(request.appType),
    staleTime: 30_000,
  });

  if (!events || events.length === 0) return null;

  const nameOf = (id: string) => providerData?.providers?.[id]?.name ?? id;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-strong font-semibold text-fg-1">
        {t("usage.detail.routingTrace", { defaultValue: "路由軌跡" })}
      </h3>
      <div className="divide-y divide-border overflow-hidden rounded-panel border border-border">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2 text-caption"
          >
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 font-mono text-badge tabular-nums text-fg-2">
              #{event.attemptIndex + 1}
            </span>
            <span className="min-w-0 truncate text-body text-fg-1">
              {nameOf(event.failedProviderId)}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-fg-3" />
            <span className="min-w-0 truncate text-body font-medium text-fg-1">
              {nameOf(event.nextProviderId)}
              <span className="ms-1.5 font-mono text-caption font-normal text-fg-3">
                {event.nextModel}
              </span>
            </span>
            <span className="ms-auto shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-badge text-warning-text">
              {event.errorClass}
            </span>
            <code
              className="w-full truncate font-mono text-caption text-fg-3"
              title={event.logicalModel}
            >
              {event.logicalModel}
            </code>
          </div>
        ))}
      </div>
    </section>
  );
}

function RequestDetailBody({ request }: { request: RequestLog }) {
  const { t } = useTranslation();
  const { currency } = useMoneyFormat();
  const sections = useDetailSections(request);
  return (
    <div className="flex flex-col gap-4">
      <DetailSection title={t("usage.basicInfo")} rows={sections.basic} />
      <DetailSection
        title={t("usage.detail.tokensTitle")}
        rows={sections.tokens}
      />
      <DetailSection
        title={t("usage.detail.costTitle", { currency })}
        rows={sections.cost}
      />
      <DetailSection
        title={t("usage.detail.performance")}
        rows={sections.performance}
      />
      <RoutingTrace request={request} />
      {request.errorMessage && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-strong font-semibold text-danger-text">
            {t("usage.errorMessage")}
          </h3>
          <p className="selectable m-0 whitespace-pre-wrap break-words rounded-panel bg-danger-soft px-3.5 py-2.5 font-mono text-caption text-fg-1">
            {request.errorMessage}
          </p>
        </section>
      )}
    </div>
  );
}

/** 请求详情抽屉（v7 S6：点表格一行打开）。 */
export function RequestDetailPanel({
  requestId,
  onClose,
}: RequestDetailPanelProps) {
  const { t } = useTranslation();
  const {
    data: request,
    isLoading,
    error,
    refetch,
  } = useRequestDetail(requestId ?? "");

  return (
    <Sheet
      open={requestId != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        width={420}
        closeLabel={t("common.close")}
        dismissOnOutsideClick
        // 不放副标题：时间、应用、供应商就是「基本信息」前三行
        aria-describedby={undefined}
      >
        <SheetHeader className="pb-3">
          <SheetTitle>{t("usage.requestDetail")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="border-t border-border">
          {isLoading ? (
            <div className="h-[320px] animate-pulse rounded-panel bg-subtle" />
          ) : request ? (
            <RequestDetailBody request={request} />
          ) : error ? (
            // 查询失败和「没有这条记录」分开说：前者能重试，也要让人看到原因
            <Notice
              tone="danger"
              title={t("usage.requestLoadFailed")}
              actions={
                <Button
                  variant="neutral"
                  size="compact"
                  onClick={() => refetch()}
                >
                  {t("common.retry")}
                </Button>
              }
            >
              {extractErrorMessage(error) || String(error)}
            </Notice>
          ) : (
            <p className="py-10 text-center text-body text-fg-3">
              {t("usage.requestNotFound")}
            </p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
