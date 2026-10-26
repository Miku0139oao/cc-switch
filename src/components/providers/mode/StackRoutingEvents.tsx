import { useMemo } from "react";
import { ArrowRight, History, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import type { StackFallbackEvent } from "@/types/proxy";
import { useStackFallbackEvents } from "@/lib/query/proxy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StackRoutingEventsProps {
  app: AppId;
  providers: Record<string, Provider>;
  /** 後端只會在聚合模式有請求時寫入；非聚合時仍可讀歷史。 */
  enabled?: boolean;
}

function formatTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 聚合換家紀錄：後端 `stack_fallback_events` 的唯一讀取入口。
 * 回答的是「剛剛為什麼換家、換了幾次、換到哪」，而不是「哪一家現在健康」。
 */
export function StackRoutingEvents({
  app,
  providers,
  enabled = true,
}: StackRoutingEventsProps) {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, refetch } = useStackFallbackEvents(
    app,
    enabled,
  );

  const events = useMemo<StackFallbackEvent[]>(() => data ?? [], [data]);
  const nameOf = (id: string) => providers[id]?.name ?? id;

  return (
    <section className="mb-4 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <History className="h-4 w-4 shrink-0 text-stack-text" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-body font-semibold text-fg-1">
            {t("mode.routingEvents.title", {
              defaultValue: "最近換家紀錄",
            })}
          </h2>
          <p className="m-0 text-caption text-fg-2">
            {t("mode.routingEvents.description", {
              defaultValue:
                "聚合請求失敗後實際換到哪一家。這裡只記聚合的模型層級備援，不含路由模式的佇列。",
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="quiet"
          size="compact"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
          />
          {t("common.refresh", { defaultValue: "重新整理" })}
        </Button>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 text-center text-caption text-fg-2">
          {t("common.loading", { defaultValue: "載入中…" })}
        </div>
      ) : events.length === 0 ? (
        <div className="px-4 py-6 text-center text-caption text-fg-2">
          {t("mode.routingEvents.empty", {
            defaultValue: "還沒有換家紀錄。聚合請求全部成功時不會留下紀錄。",
          })}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
            >
              <time
                className="shrink-0 font-mono text-caption tabular-nums text-fg-3"
                dateTime={new Date(event.createdAt * 1000).toISOString()}
                title={new Date(event.createdAt * 1000).toLocaleString()}
              >
                {formatTime(event.createdAt)}
              </time>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-badge font-medium text-fg-2">
                {t("mode.routingEvents.attempt", {
                  defaultValue: "第 {{index}} 段",
                  index: event.attemptIndex + 1,
                })}
              </span>
              <span className="min-w-0 truncate text-body text-fg-1">
                {nameOf(event.failedProviderId)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-3" />
              <span className="min-w-0 truncate text-body font-medium text-fg-1">
                {nameOf(event.nextProviderId)}
                <span className="ms-1.5 font-mono text-caption font-normal text-fg-3">
                  {event.nextModel}
                </span>
              </span>
              <span className="ms-auto inline-flex min-w-0 items-center gap-1.5">
                <code
                  className="truncate rounded bg-subtle px-1.5 py-0.5 font-mono text-caption text-fg-2"
                  title={event.logicalModel}
                >
                  {event.logicalModel}
                </code>
                <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-badge text-warning-text">
                  {event.errorClass}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
