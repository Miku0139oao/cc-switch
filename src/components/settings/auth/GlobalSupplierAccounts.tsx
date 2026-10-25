import {
  Check,
  Download,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { providersApi, universalProvidersApi, type AppId } from "@/lib/api";
import type {
  Provider,
  UniversalProvider,
  UniversalProvidersMap,
} from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";
import {
  extractCodexBaseUrl,
  extractCodexExperimentalBearerToken,
} from "@/utils/providerConfigUtils";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UniversalProviderFormModal } from "@/components/universal/UniversalProviderFormModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type SharedAgentId = "claude" | "codex" | "gemini";

const SHARED_AGENTS: {
  id: SharedAgentId;
  name: string;
  short: string;
  color: string;
}[] = [
  { id: "claude", name: "Claude Code", short: "CC", color: "#d97757" },
  { id: "codex", name: "Codex", short: "CX", color: "#6aa7ff" },
  { id: "gemini", name: "Gemini CLI", short: "GM", color: "#a889ff" },
];

interface ImportProviderOption {
  app: SharedAgentId;
  provider: Provider;
  draft: UniversalProvider;
}

function endpointLabel(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.host}${path}`;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function maskedKey(value: string): string {
  if (!value) return "—";
  if (value.length <= 4) return "••••";
  return `••••••••${value.slice(-4)}`;
}

function enabledAgents(provider: UniversalProvider): SharedAgentId[] {
  return SHARED_AGENTS.filter((agent) => provider.apps[agent.id]).map(
    (agent) => agent.id,
  );
}

function configString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function importedCredentials(
  app: SharedAgentId,
  provider: Provider,
): { baseUrl: string; apiKey: string } {
  const config = provider.settingsConfig as Record<string, unknown>;
  if (app === "claude") {
    const env = (config.env ?? {}) as Record<string, unknown>;
    return {
      baseUrl: configString(env.ANTHROPIC_BASE_URL),
      apiKey:
        configString(env.ANTHROPIC_AUTH_TOKEN) ||
        configString(env.ANTHROPIC_API_KEY),
    };
  }
  if (app === "codex") {
    const auth = (config.auth ?? {}) as Record<string, unknown>;
    const toml = typeof config.config === "string" ? config.config : "";
    return {
      baseUrl: extractCodexBaseUrl(toml) ?? "",
      apiKey:
        typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim()
          ? auth.OPENAI_API_KEY
          : (extractCodexExperimentalBearerToken(toml) ?? ""),
    };
  }
  const env = (config.env ?? {}) as Record<string, unknown>;
  return {
    baseUrl: configString(env.GOOGLE_GEMINI_BASE_URL),
    apiKey:
      configString(env.GEMINI_API_KEY) || configString(env.GOOGLE_API_KEY),
  };
}

function draftFromProvider(
  app: SharedAgentId,
  provider: Provider,
): UniversalProvider | null {
  const { baseUrl, apiKey } = importedCredentials(app, provider);
  if (!baseUrl.trim() || !apiKey.trim()) return null;
  const config = provider.settingsConfig as Record<string, unknown>;
  const env = (config.env ?? {}) as Record<string, unknown>;
  const codexToml = typeof config.config === "string" ? config.config : "";
  const codexModel =
    codexToml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? undefined;

  return {
    id: crypto.randomUUID(),
    name: provider.name,
    providerType: "custom",
    apps: {
      claude: app === "claude",
      codex: app === "codex",
      gemini: app === "gemini",
    },
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    models:
      app === "claude"
        ? {
            claude: {
              model: configString(env.ANTHROPIC_MODEL) || undefined,
              haikuModel:
                configString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) || undefined,
              sonnetModel:
                configString(env.ANTHROPIC_DEFAULT_SONNET_MODEL) || undefined,
              opusModel:
                configString(env.ANTHROPIC_DEFAULT_OPUS_MODEL) || undefined,
            },
          }
        : app === "codex"
          ? {
              codex: {
                model: codexModel,
                reasoningEffort:
                  codexToml.match(
                    /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m,
                  )?.[1] ?? undefined,
              },
            }
          : {
              gemini: {
                model: configString(env.GEMINI_MODEL) || undefined,
              },
            },
    websiteUrl: provider.websiteUrl,
    notes: provider.notes,
    icon: provider.icon,
    iconColor: provider.iconColor,
    meta: provider.meta,
    createdAt: Date.now(),
  };
}

function AgentChip({ agent }: { agent: (typeof SHARED_AGENTS)[number] }) {
  return (
    <span
      title={agent.name}
      className="inline-flex h-6 items-center gap-1.5 rounded-[5px] border border-border bg-subtle/60 px-2 text-caption font-medium text-fg-2"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: agent.color }}
      />
      {agent.short}
    </span>
  );
}

export function GlobalSupplierAccounts() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<UniversalProvidersMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agent, setAgent] = useState<SharedAgentId | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UniversalProvider | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importRows, setImportRows] = useState<ImportProviderOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UniversalProvider | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await universalProvidersApi.getAll());
    } catch (error) {
      toast.error(
        t("authCenter.providers.loadFailed", {
          defaultValue: "無法載入全域供應商",
        }),
        { description: extractErrorMessage(error) },
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return Object.values(providers)
      .filter((provider) => {
        if (agent !== "all" && !provider.apps[agent]) return false;
        if (!needle) return true;
        return [provider.name, provider.baseUrl, provider.notes ?? ""]
          .join("\n")
          .toLocaleLowerCase()
          .includes(needle);
      })
      .sort(
        (a, b) =>
          (a.sortIndex ?? Number.MAX_SAFE_INTEGER) -
            (b.sortIndex ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      );
  }, [agent, providers, search]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openImport = async () => {
    setImportOpen(true);
    setImportLoading(true);
    try {
      const all = await Promise.all(
        SHARED_AGENTS.map(async (agent) => ({
          agent,
          providers: await providersApi.getAll(agent.id as AppId),
        })),
      );
      const rows = all.flatMap(({ agent, providers }) =>
        Object.values(providers).flatMap((provider) => {
          const draft = draftFromProvider(agent.id, provider);
          return draft ? [{ app: agent.id, provider, draft }] : [];
        }),
      );
      setImportRows(rows);
    } catch (error) {
      toast.error(
        t("authCenter.providers.importFailed", {
          defaultValue: "無法讀取既有供應商",
        }),
        { description: extractErrorMessage(error) },
      );
    } finally {
      setImportLoading(false);
    }
  };

  const openEdit = (provider: UniversalProvider) => {
    setEditing(provider);
    setFormOpen(true);
  };

  const importProvider = (option: ImportProviderOption) => {
    setEditing(option.draft);
    setImportOpen(false);
    setFormOpen(true);
  };

  const save = async (provider: UniversalProvider) => {
    setSaving(true);
    try {
      await universalProvidersApi.upsert(provider);
      await universalProvidersApi.sync(provider.id);
      await load();
      toast.success(
        t("authCenter.providers.saved", {
          defaultValue: "供應商已儲存並同步",
        }),
        { closeButton: true },
      );
    } catch (error) {
      toast.error(
        t("authCenter.providers.saveFailed", {
          defaultValue: "儲存供應商失敗",
        }),
        { description: extractErrorMessage(error) },
      );
    } finally {
      setSaving(false);
    }
  };

  const sync = async (provider: UniversalProvider) => {
    setSyncingId(provider.id);
    try {
      await universalProvidersApi.sync(provider.id);
      toast.success(
        t("authCenter.providers.synced", {
          defaultValue: "已同步到各 Agent",
        }),
        { closeButton: true },
      );
    } catch (error) {
      toast.error(
        t("authCenter.providers.syncFailed", {
          defaultValue: "同步供應商失敗",
        }),
        { description: extractErrorMessage(error) },
      );
    } finally {
      setSyncingId(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await universalProvidersApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      toast.success(
        t("authCenter.providers.deleted", {
          defaultValue: "全域供應商已刪除",
        }),
      );
    } catch (error) {
      toast.error(
        t("authCenter.providers.deleteFailed", {
          defaultValue: "刪除供應商失敗",
        }),
        { description: extractErrorMessage(error) },
      );
    }
  };

  return (
    <section className="rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <KeyRoundIcon />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-body font-semibold text-fg-1">
              {t("authCenter.providers.title", {
                defaultValue: "全域供應商",
              })}
            </h2>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-caption text-fg-2">
              {Object.keys(providers).length}
            </span>
          </div>
          <p className="m-0 mt-0.5 text-caption text-fg-2">
            {t("authCenter.providers.description", {
              defaultValue:
                "集中管理 API Key 與 Endpoint；每個 Agent 仍各自選擇要使用的供應商。",
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="quiet"
          size="compact"
          onClick={() => void openImport()}
        >
          <Download className="h-3.5 w-3.5" />
          {t("authCenter.providers.importExisting", {
            defaultValue: "從現有供應商匯入",
          })}
        </Button>
        <Button
          type="button"
          variant="default"
          size="compact"
          onClick={openNew}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("authCenter.providers.add", {
            defaultValue: "新增供應商",
          })}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 ps-8"
            placeholder={t("authCenter.providers.search", {
              defaultValue: "搜尋供應商或 Endpoint",
            })}
          />
        </div>
        <Select
          value={agent}
          onValueChange={(value) => setAgent(value as SharedAgentId | "all")}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("authCenter.providers.allAgents", {
                defaultValue: "全部 Agent",
              })}
            </SelectItem>
            {SHARED_AGENTS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-caption text-fg-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading", { defaultValue: "載入中…" })}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-[7px] bg-subtle text-fg-3">
            <KeyRoundIcon />
          </div>
          <div>
            <div className="text-body font-medium text-fg-1">
              {t("authCenter.providers.empty", {
                defaultValue: "還沒建立全域供應商",
              })}
            </div>
            <p className="m-0 mt-1 text-caption text-fg-2">
              {t("authCenter.providers.emptyHint", {
                defaultValue:
                  "建立後會同步成各 Agent 可選用的 provider；目前使用中的 provider 不會自動切換。",
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            onClick={openNew}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("authCenter.providers.add", {
              defaultValue: "新增供應商",
            })}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((provider) => {
            const agents = enabledAgents(provider);
            return (
              <div
                key={provider.id}
                className="grid min-w-0 grid-cols-[minmax(190px,1.4fr)_minmax(160px,1fr)_minmax(130px,.8fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-subtle/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderIcon
                    icon={provider.icon}
                    name={provider.name}
                    size={30}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-body font-medium text-fg-1">
                      {provider.name}
                    </div>
                    <div className="truncate font-mono text-caption text-fg-3">
                      {endpointLabel(provider.baseUrl)}
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-caption text-fg-3">
                    {t("authCenter.providers.sharedCredential", {
                      defaultValue: "共用憑證",
                    })}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-caption text-fg-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-success-text" />
                    {maskedKey(provider.apiKey)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {agents.length > 0 ? (
                    agents.map((id) => {
                      const item = SHARED_AGENTS.find(
                        (candidate) => candidate.id === id,
                      )!;
                      return <AgentChip key={id} agent={item} />;
                    })
                  ) : (
                    <span className="text-caption text-fg-3">
                      {t("authCenter.providers.noAgents", {
                        defaultValue: "未提供給任何 Agent",
                      })}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon-compact"
                    aria-label={t("authCenter.providers.sync", {
                      defaultValue: "同步 {{name}}",
                      name: provider.name,
                    })}
                    disabled={syncingId === provider.id}
                    onClick={() => void sync(provider)}
                  >
                    {syncingId === provider.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="compact"
                    onClick={() => openEdit(provider)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("authCenter.providers.edit", {
                      defaultValue: "編輯",
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon-compact"
                    aria-label={t("authCenter.providers.delete", {
                      defaultValue: "刪除 {{name}}",
                      name: provider.name,
                    })}
                    onClick={() => setDeleteTarget(provider)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-border bg-subtle/25 px-4 py-2.5 text-caption text-fg-2">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-text" />
        <span>
          {t("authCenter.providers.independentHint", {
            defaultValue:
              "同步只會建立或更新各 Agent 可選用的 provider，不會替任何 Agent 切換目前使用中的供應商。",
          })}
        </span>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-[620px]">
          <DialogTitle>
            {t("authCenter.providers.importTitle", {
              defaultValue: "從現有供應商匯入",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("authCenter.providers.importDescription", {
              defaultValue:
                "選擇一個既有 provider 作為起點。匯入只會建立新的全域供應商，不會刪除或切換原本的卡片。",
            })}
          </DialogDescription>
          <div className="mt-3 max-h-[430px] overflow-y-auto rounded-control border border-border">
            {importLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-caption text-fg-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading", { defaultValue: "載入中…" })}
              </div>
            ) : importRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-caption text-fg-2">
                {t("authCenter.providers.noImportable", {
                  defaultValue:
                    "找不到具備 Base URL 與 API Key 的 Claude Code、Codex 或 Gemini 供應商。",
                })}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {importRows.map((option) => {
                  const agent = SHARED_AGENTS.find(
                    (candidate) => candidate.id === option.app,
                  )!;
                  return (
                    <div
                      key={`${option.app}:${option.provider.id}`}
                      className="flex min-w-0 items-center gap-3 px-3 py-2.5"
                    >
                      <ProviderIcon
                        icon={option.provider.icon}
                        name={option.provider.name}
                        size={28}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body font-medium text-fg-1">
                          {option.provider.name}
                        </div>
                        <div className="truncate text-caption text-fg-3">
                          {agent.name} · {endpointLabel(option.draft.baseUrl)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="quiet"
                        size="compact"
                        onClick={() => importProvider(option)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("authCenter.providers.importAction", {
                          defaultValue: "匯入",
                        })}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <UniversalProviderFormModal
        isOpen={formOpen}
        editingProvider={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={(provider) => void save(provider)}
        onSaveAndSync={(provider) => void save(provider)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title={t("authCenter.providers.deleteTitle", {
          defaultValue: "刪除全域供應商",
        })}
        message={t("authCenter.providers.deleteDescription", {
          defaultValue:
            "確定刪除「{{name}}」？各 Agent 中由它同步建立的 provider 也會一起刪除。",
          name: deleteTarget?.name ?? "",
        })}
        confirmText={t("common.delete", { defaultValue: "刪除" })}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteTarget(null)}
      />
      {saving && (
        <span className="sr-only">
          {t("authCenter.providers.saving", {
            defaultValue: "正在儲存供應商…",
          })}
        </span>
      )}
    </section>
  );
}

function KeyRoundIcon() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-action-soft text-action-text">
      <ShieldCheck className="h-4 w-4" />
    </div>
  );
}
