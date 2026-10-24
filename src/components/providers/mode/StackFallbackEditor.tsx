import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, ShieldCheck, X } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [candidate, setCandidate] = useState("");

  const allModels = useMemo<PublishedModel[]>(
    () =>
      (stack?.members ?? []).flatMap((member) =>
        member.models.map((model) => ({
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
          const model = member.models.find((entry) => entry.id === id);
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

  useEffect(() => {
    if (!editing) return;
    setDraft(
      (stack?.fallbacks?.[editing.model.id] ?? []).map((target) => ({
        ...target,
      })),
    );
    setCandidate("");
  }, [editing, stack?.fallbacks]);

  const primaryKey = editing
    ? targetKey({
        providerId: editing.providerId,
        upstreamModel: editing.model.upstreamModel,
      })
    : "";
  const usedKeys = new Set(draft.map(targetKey));
  const candidates = allModels.filter(
    (item) => modelKey(item) !== primaryKey && !usedKeys.has(modelKey(item)),
  );

  const addCandidate = () => {
    const item = allModels.find((entry) => modelKey(entry) === candidate);
    if (!item) return;
    setDraft((current) => [
      ...current,
      {
        providerId: item.providerId,
        upstreamModel: item.model.upstreamModel,
      },
    ]);
    setCandidate("");
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
          const chain = stack.fallbacks?.[item.model.id] ?? [];
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
                  {chain.length
                    ? t("mode.fallback.count", { count: chain.length })
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

            <div className="mt-4 space-y-2">
              <div className="rounded-control bg-subtle px-3 py-2 text-body">
                <span className="me-2 text-caption font-semibold text-stack-text">
                  {t("mode.fallback.primary")}
                </span>
                {editing.model.displayName} · {editing.providerName}
              </div>
              {draft.map((target, index) => (
                <div
                  key={`${targetKey(target)}-${index}`}
                  className="flex items-center gap-2 rounded-control border border-border px-3 py-2"
                >
                  <span className="w-6 text-caption tabular-nums text-fg-3">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body">
                    {labelOf(target)}
                  </span>
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
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <Select
                  value={candidate}
                  onValueChange={setCandidate}
                  disabled={candidates.length === 0}
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue
                      placeholder={t("mode.fallback.chooseCandidate")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((item) => (
                      <SelectItem key={modelKey(item)} value={modelKey(item)}>
                        {item.model.displayName} · {item.providerName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="neutral"
                  disabled={!candidate}
                  onClick={addCandidate}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("mode.fallback.add")}
                </Button>
              </div>
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
                      targets: draft,
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
