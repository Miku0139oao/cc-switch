import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ListOrdered,
  Plus,
  Route,
  ShieldCheck,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import type {
  ProxyStack,
  ProxyStackModel,
  StackFallbackTarget,
} from "@/types/proxy";
import type { AppId } from "@/lib/api";
import { useSetStackFallbackChain } from "@/lib/query/proxy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";

interface PublishedModel {
  providerId: string;
  providerName: string;
  model: ProxyStackModel;
}

interface StackFallbackEditorProps {
  app: AppId;
  stack: ProxyStack | undefined;
  providers: Record<string, Provider>;
}

function targetKey(target: StackFallbackTarget): string {
  return `${target.providerId}\u0000${target.upstreamModel}`;
}

function modelKey(item: PublishedModel): string {
  return targetKey({
    providerId: item.providerId,
    upstreamModel: item.model.upstreamModel,
  });
}

export function StackFallbackEditor({
  app,
  stack,
  providers,
}: StackFallbackEditorProps) {
  const { t } = useTranslation();
  const save = useSetStackFallbackChain();
  const [editing, setEditing] = useState<PublishedModel | null>(null);
  const [draft, setDraft] = useState<StackFallbackTarget[]>([]);
  const [mode, setMode] = useState<"automatic" | "custom">("automatic");
  const [pickerOpen, setPickerOpen] = useState(false);

  const allModels = useMemo<PublishedModel[]>(
    () =>
      (stack?.members ?? []).flatMap((member) =>
        (member.models ?? []).map((model) => ({
          providerId: member.providerId,
          providerName: providers[member.providerId]?.name ?? member.providerId,
          model,
        })),
      ),
    [providers, stack?.members],
  );
  const primary = useMemo(
    () =>
      (stack?.members ?? []).flatMap((member) =>
        member.modelIds.flatMap((id) => {
          const model = (member.models ?? []).find((entry) => entry.id === id);
          return model
            ? [
                {
                  providerId: member.providerId,
                  providerName:
                    providers[member.providerId]?.name ?? member.providerId,
                  model,
                },
              ]
            : [];
        }),
      ),
    [providers, stack?.members],
  );
  const providerRanks = useMemo(() => {
    const ranks = new Map<string, string>();
    let priority = 0;
    for (const member of stack?.members ?? []) {
      ranks.set(
        member.providerId,
        member.route ? t("mode.fallback.defaultRank") : `#${priority++}`,
      );
    }
    return ranks;
  }, [stack?.members, t]);
  const providerGroups = useMemo(() => {
    const groups = new Map<string, PublishedModel[]>();
    for (const item of allModels) {
      const group = groups.get(item.providerId) ?? [];
      group.push(item);
      groups.set(item.providerId, group);
    }
    const members = stack?.members ?? [];
    return [
      ...members.filter((member) => member.route),
      ...members.filter((member) => !member.route),
    ].flatMap((member) => {
      const group = groups.get(member.providerId);
      return group ? [group] : [];
    });
  }, [allModels, stack?.members]);

  useEffect(() => {
    if (!editing) return;
    setDraft(
      (stack?.fallbacks?.[editing.model.id] ?? []).map((target) => ({
        ...target,
      })),
    );
    setMode(
      (stack?.fallbacks?.[editing.model.id]?.length ?? 0) > 0
        ? "custom"
        : "automatic",
    );
    setPickerOpen(false);
  }, [editing, stack?.fallbacks]);

  const primaryKey = editing
    ? targetKey({
        providerId: editing.providerId,
        upstreamModel: editing.model.upstreamModel,
      })
    : "";
  const automaticChain = editing
    ? (stack?.effectiveFallbacks?.[editing.model.id] ?? [])
    : [];
  const usingAutomatic = mode === "automatic";
  const previewChain = usingAutomatic ? automaticChain : draft;
  const usedKeys = new Set(draft.map(targetKey));
  const candidates = allModels.filter(
    (item) => modelKey(item) !== primaryKey && !usedKeys.has(modelKey(item)),
  );

  const addCandidate = (item: PublishedModel) => {
    setDraft((current) => [
      ...current,
      {
        providerId: item.providerId,
        upstreamModel: item.model.upstreamModel,
      },
    ]);
    setMode("custom");
    setPickerOpen(false);
  };

  const changeMode = (next: "automatic" | "custom") => {
    if (next === "custom" && draft.length === 0) {
      setDraft(automaticChain.map((target) => ({ ...target })));
    }
    if (next === "automatic") {
      setDraft([]);
    }
    setMode(next);
    setPickerOpen(false);
  };

  const move = (index: number, delta: -1 | 1) => {
    setDraft((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const labelOf = (target: StackFallbackTarget) => {
    const item = allModels.find(
      (entry) =>
        entry.providerId === target.providerId &&
        entry.model.upstreamModel === target.upstreamModel,
    );
    return item
      ? `${item.model.displayName} · ${item.providerName}`
      : `${target.upstreamModel} · ${target.providerId}`;
  };

  if (!stack || primary.length === 0) return null;

  return (
    <section className="mb-4 rounded-panel border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldCheck className="h-4 w-4 text-stack-text" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-body font-semibold text-fg-1">
            {t("mode.fallback.title")}
          </h2>
          <p className="m-0 text-caption text-fg-2">
            {t("mode.fallback.description")}
          </p>
        </div>
      </div>
      <div className="divide-y divide-border">
        {primary.map((item) => {
          const explicitChain = stack.fallbacks?.[item.model.id] ?? [];
          const chain =
            stack.effectiveFallbacks?.[item.model.id] ?? explicitChain;
          const automatic = explicitChain.length === 0 && chain.length > 0;
          const firstFallback = chain[0]
            ? (providers[chain[0].providerId]?.name ?? chain[0].providerId)
            : "";
          return (
            <div
              key={item.model.id}
              className="flex min-w-0 items-center gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-fg-1">
                  {item.model.displayName}
                </div>
                <div className="truncate text-caption text-fg-2">
                  {item.providerName} ·{" "}
                  {automatic
                    ? t("mode.fallback.autoCount", {
                        count: chain.length,
                        first: firstFallback,
                      })
                    : chain.length
                      ? t("mode.fallback.customCount", { count: chain.length })
                      : t("mode.fallback.none")}
                </div>
              </div>
              <Button
                type="button"
                variant="quiet"
                size="compact"
                onClick={() => setEditing(item)}
              >
                {t("mode.fallback.configure")}
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        {editing && (
          <DialogContent className="max-w-[560px]">
            <DialogTitle>{t("mode.fallback.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("mode.fallback.dialogDescription", {
                model: editing.model.displayName,
              })}
            </DialogDescription>

            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
              <SegmentedControl
                size="sm"
                value={mode}
                onValueChange={changeMode}
                aria-label={t("mode.fallback.modeLabel")}
                items={[
                  {
                    value: "automatic",
                    label: t("mode.fallback.automaticMode"),
                    icon: Route,
                  },
                  {
                    value: "custom",
                    label: t("mode.fallback.customMode"),
                    icon: ListOrdered,
                  },
                ]}
              />
              <div className="rounded-control bg-subtle px-3 py-2 text-body">
                <span className="me-2 text-caption font-semibold text-stack-text">
                  {t("mode.fallback.primary")}
                </span>
                {editing.model.displayName} · {editing.providerName}
              </div>
              {usingAutomatic ? (
                <div className="rounded-control border border-stack-border bg-stack-soft px-3 py-2">
                  <div className="text-caption font-semibold text-stack-text">
                    {t("mode.fallback.automaticTitle")}
                  </div>
                  <div className="mt-0.5 text-caption text-fg-2">
                    {t("mode.fallback.automaticHint")}
                  </div>
                </div>
              ) : (
                <p className="m-0 text-caption text-fg-2">
                  {t("mode.fallback.customHint")}
                </p>
              )}
              {previewChain.length === 0 ? (
                <div className="rounded-control border border-dashed border-border px-3 py-4 text-center text-caption text-fg-2">
                  {t("mode.fallback.noTargets")}
                </div>
              ) : (
                previewChain.map((target, index) => (
                  <div
                    key={`${targetKey(target)}-${index}`}
                    className="flex items-center gap-2 rounded-control border border-border px-3 py-2"
                  >
                    <span className="w-5 text-caption tabular-nums text-fg-3">
                      {index + 1}
                    </span>
                    <span className="shrink-0 rounded-full bg-subtle px-1.5 py-0.5 text-micro font-semibold text-fg-2">
                      {providerRanks.get(target.providerId) ??
                        target.providerId}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body">
                      {labelOf(target)}
                    </span>
                    {!usingAutomatic && (
                      <>
                        <Button
                          type="button"
                          variant="quiet"
                          size="icon-compact"
                          disabled={index === 0}
                          aria-label={t("mode.fallback.moveUp")}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          size="icon-compact"
                          disabled={index === draft.length - 1}
                          aria-label={t("mode.fallback.moveDown")}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          size="icon-compact"
                          aria-label={t("common.remove")}
                          onClick={() =>
                            setDraft((current) =>
                              current.filter((_, item) => item !== index),
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}

              {!usingAutomatic && (
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      className="flex h-9 w-full items-center justify-between rounded-control border border-border-strong bg-surface px-3 text-body text-fg-2 hover:bg-subtle hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">
                        {t("mode.fallback.chooseCandidate")}
                      </span>
                      <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    sideOffset={6}
                    collisionPadding={12}
                  >
                    <Command>
                      <CommandInput
                        placeholder={t("mode.fallback.searchCandidate")}
                      />
                      <CommandList className="max-h-[min(360px,50vh)]">
                        <CommandEmpty>
                          {t("mode.fallback.noCandidates")}
                        </CommandEmpty>
                        {providerGroups.map((group) => {
                          const groupCandidates = group.filter((item) =>
                            candidates.some(
                              (candidate) =>
                                modelKey(candidate) === modelKey(item),
                            ),
                          );
                          if (groupCandidates.length === 0) return null;
                          const provider = groupCandidates[0];
                          return (
                            <CommandGroup
                              key={provider.providerId}
                              heading={`${providerRanks.get(provider.providerId) ?? provider.providerId} · ${provider.providerName}`}
                            >
                              {groupCandidates.map((item) => (
                                <CommandItem
                                  key={modelKey(item)}
                                  value={modelKey(item)}
                                  keywords={[
                                    item.providerName,
                                    item.model.displayName,
                                    item.model.upstreamModel,
                                  ]}
                                  onSelect={() => addCandidate(item)}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    {item.model.displayName}
                                  </span>
                                  <span className="shrink-0 text-caption text-fg-3">
                                    {item.model.upstreamModel}
                                  </span>
                                  <Plus className="h-3.5 w-3.5 shrink-0" />
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          );
                        })}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="neutral"
                onClick={() => setEditing(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="stack"
                disabled={save.isPending}
                onClick={() => {
                  void save
                    .mutateAsync({
                      appType: app,
                      modelId: editing.model.id,
                      targets: mode === "custom" ? draft : [],
                    })
                    .then(() => setEditing(null));
                }}
              >
                {t("common.save")}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
