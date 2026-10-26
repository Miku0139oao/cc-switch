import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Route, TriangleAlert } from "lucide-react";
import type { CodexSessionModelTarget } from "@/types";
import {
  useClearCodexSessionRoute,
  useCodexSessionModels,
  useCodexSessionRoutes,
  useSetCodexSessionRoute,
} from "@/lib/query/sessions";
import { useAppMode } from "@/lib/query/proxy";
import { toast } from "@/lib/toast";
import { extractErrorMessage } from "@/utils/errorUtils";
import { HoverTip } from "@/components/ui/hover-tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SessionModelRoutePickerProps {
  sessionId: string;
  fallbackModel?: string;
}

const targetKey = (target: CodexSessionModelTarget) =>
  `${target.providerId}\u0000${target.upstreamModel}`;

export function SessionModelRoutePicker({
  sessionId,
  fallbackModel,
}: SessionModelRoutePickerProps) {
  const { t } = useTranslation();
  const { data: mode } = useAppMode("codex");
  const { data: routes } = useCodexSessionRoutes();
  const { data: models, isLoading } = useCodexSessionModels();
  const setRoute = useSetCodexSessionRoute();
  const clearRoute = useClearCodexSessionRoute();
  const active = routes?.[sessionId];
  const byProvider = useMemo(() => {
    const grouped = new Map<string, CodexSessionModelTarget[]>();
    for (const target of models ?? []) {
      const entries = grouped.get(target.providerId) ?? [];
      entries.push(target);
      grouped.set(target.providerId, entries);
    }
    return Array.from(grouped.values());
  }, [models]);

  if (isLoading || byProvider.length === 0) return null;

  const selected = active
    ? (models ?? []).find(
        (target) =>
          target.providerId === active.providerId &&
          target.upstreamModel === active.upstreamModel,
      )
    : undefined;
  const label = active
    ? `${selected?.providerName ?? active.providerId} · ${active.upstreamModel}`
    : fallbackModel || t("sessionManager.sessionRoute.global");
  const routingOff = mode?.mode === "direct";
  const tooltip = routingOff
    ? t("sessionManager.sessionRoute.routingOffHint")
    : t("sessionManager.sessionRoute.hint");

  const apply = async (target: CodexSessionModelTarget) => {
    try {
      await setRoute.mutateAsync({
        sessionId,
        providerId: target.providerId,
        upstreamModel: target.upstreamModel,
      });
      toast.success(t("sessionManager.sessionRoute.saved"), {
        description: t("sessionManager.sessionRoute.nextTurn"),
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("sessionManager.sessionRoute.saveFailed"), {
        description: extractErrorMessage(error),
      });
    }
  };

  const clear = async () => {
    try {
      await clearRoute.mutateAsync(sessionId);
      toast.success(t("sessionManager.sessionRoute.cleared"), {
        description: t("sessionManager.sessionRoute.nextTurn"),
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("sessionManager.sessionRoute.saveFailed"), {
        description: extractErrorMessage(error),
      });
    }
  };

  return (
    <DropdownMenu>
      <HoverTip content={tooltip}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("sessionManager.sessionRoute.label")}
            aria-busy={setRoute.isPending || clearRoute.isPending}
            className={cn(
              "inline-flex h-7 max-w-[min(42vw,360px)] shrink-0 items-center gap-1.5 rounded-control border border-border bg-surface px-2 text-caption text-fg-2 transition-colors hover:bg-subtle hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-stack-border text-stack-text",
              routingOff && "text-fg-3",
            )}
          >
            {routingOff ? (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Route className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate font-mono">{label}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
      </HoverTip>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(70vh,520px)] min-w-64 overflow-y-auto"
      >
        <DropdownMenuLabel>
          {t("sessionManager.sessionRoute.menuTitle")}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={!active} onSelect={() => void clear()}>
          {t("sessionManager.sessionRoute.useGlobal")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {byProvider.map((targets) => (
          <DropdownMenuSub key={targets[0].providerId}>
            <DropdownMenuSubTrigger>
              <span className="min-w-0 flex-1 truncate">
                {targets[0].providerName}
              </span>
              {targets[0].official && (
                <span className="text-micro text-fg-3">
                  {t("sessionManager.sessionRoute.official")}
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 min-w-64 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={
                  active &&
                  targets.some(
                    (target) =>
                      target.providerId === active.providerId &&
                      target.upstreamModel === active.upstreamModel,
                  )
                    ? `${active.providerId}\u0000${active.upstreamModel}`
                    : ""
                }
              >
                {targets.map((target) => (
                  <DropdownMenuRadioItem
                    key={targetKey(target)}
                    value={targetKey(target)}
                    onSelect={() => void apply(target)}
                  >
                    <span className="min-w-0 truncate font-mono">
                      {target.upstreamModel}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
