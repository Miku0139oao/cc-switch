import { Minus, Plus, Save, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import type { BalanceStrategy, ProxyStack } from "@/types/proxy";
import { useSetStackBalancePolicy } from "@/lib/query/proxy";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STRATEGIES: BalanceStrategy[] = [
  "priority",
  "roundRobin",
  "weightedRoundRobin",
  "leastLoad",
];

interface StackLoadBalancePanelProps {
  app: string;
  stack: ProxyStack | undefined;
  providers: Record<string, Provider>;
}

function clampWeight(value: number): number {
  return Math.max(1, Math.min(100, Number.isFinite(value) ? value : 1));
}

function sameWeights(
  left: Record<string, number>,
  right: Record<string, number> | undefined,
): boolean {
  const current = right ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(current)]);
  return [...keys].every((key) => (left[key] ?? 1) === (current[key] ?? 1));
}

export function StackLoadBalancePanel({
  app,
  stack,
  providers,
}: StackLoadBalancePanelProps) {
  const { t } = useTranslation();
  const save = useSetStackBalancePolicy();
  const members = useMemo(() => stack?.members ?? [], [stack?.members]);
  const [strategy, setStrategy] = useState<BalanceStrategy>(
    stack?.balanceStrategy ?? "priority",
  );
  const [weights, setWeights] = useState<Record<string, number>>({});

  useEffect(() => {
    setStrategy(stack?.balanceStrategy ?? "priority");
    setWeights(
      Object.fromEntries(
        members.map((member) => [
          member.providerId,
          stack?.balanceWeights?.[member.providerId] ?? 1,
        ]),
      ),
    );
  }, [members, stack?.balanceStrategy, stack?.balanceWeights]);

  if (!stack || members.length === 0) return null;

  const weighted =
    strategy === "weightedRoundRobin" || strategy === "leastLoad";
  const totalWeight = members.reduce(
    (sum, member) => sum + clampWeight(weights[member.providerId] ?? 1),
    0,
  );
  const dirty =
    strategy !== stack.balanceStrategy ||
    !sameWeights(weights, stack.balanceWeights);

  const changeWeight = (providerId: string, delta: number) => {
    setWeights((current) => ({
      ...current,
      [providerId]: clampWeight((current[providerId] ?? 1) + delta),
    }));
  };

  const apply = () => {
    save.mutate({
      appType: app,
      strategy,
      weights: Object.fromEntries(
        members.map((member) => [
          member.providerId,
          clampWeight(weights[member.providerId] ?? 1),
        ]),
      ),
    });
  };

  return (
    <section className="mb-4 rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Scale className="h-4 w-4 shrink-0 text-stack-text" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-body font-semibold text-fg-1">
            {t("mode.balance.title")}
          </h2>
          <p className="m-0 text-caption text-fg-2">
            {t("mode.balance.stickyCount", {
              count: stack.balancedSessionCount ?? 0,
            })}
          </p>
        </div>
        <Select
          value={strategy}
          onValueChange={(value) => setStrategy(value as BalanceStrategy)}
        >
          <SelectTrigger className="w-full sm:w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STRATEGIES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`mode.balance.strategies.${value}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="m-0 text-caption text-fg-2">
          {t(`mode.balance.strategies.${strategy}.description`)}
        </p>
        {weighted && (
          <div className="divide-y divide-border overflow-hidden rounded-control border border-border">
            {members.map((member) => {
              const weight = clampWeight(weights[member.providerId] ?? 1);
              const share = totalWeight
                ? Math.round((weight / totalWeight) * 100)
                : 0;
              return (
                <div
                  key={member.providerId}
                  className="flex min-w-0 items-center gap-3 bg-subtle/30 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium text-fg-1">
                      {providers[member.providerId]?.name ?? member.providerId}
                    </div>
                    <div className="text-caption text-fg-3">
                      {t("mode.balance.share", { value: share })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-control border border-border bg-surface p-0.5">
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon-compact"
                      aria-label={t("mode.balance.decrease")}
                      disabled={weight <= 1}
                      onClick={() => changeWeight(member.providerId, -1)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <input
                      aria-label={t("mode.balance.weightFor", {
                        name:
                          providers[member.providerId]?.name ??
                          member.providerId,
                      })}
                      className="w-10 appearance-none bg-transparent text-center text-body tabular-nums text-fg-1 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      type="number"
                      min={1}
                      max={100}
                      value={weight}
                      onChange={(event) =>
                        setWeights((current) => ({
                          ...current,
                          [member.providerId]: clampWeight(
                            event.currentTarget.valueAsNumber,
                          ),
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon-compact"
                      aria-label={t("mode.balance.increase")}
                      disabled={weight >= 100}
                      onClick={() => changeWeight(member.providerId, 1)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            variant="default"
            size="compact"
            disabled={!dirty || save.isPending}
            onClick={apply}
          >
            <Save className="h-3.5 w-3.5" />
            {save.isPending
              ? t("mode.balance.saving")
              : t("mode.balance.apply")}
          </Button>
        </div>
      </div>
    </section>
  );
}
