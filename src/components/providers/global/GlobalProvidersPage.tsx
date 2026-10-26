import { useTranslation } from "react-i18next";
import { Boxes } from "lucide-react";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { GlobalSupplierAccounts } from "@/components/settings/auth/GlobalSupplierAccounts";

/**
 * 全域供應商頁：跨 Agent 共用的 API Key / Endpoint 只在這裡管理一次，
 * 再分別發布成各 Agent 可選用的 provider。和「授權中心」（OAuth 帳號）分開，
 * 因為兩者回答的是不同問題：這裡是「我用哪個中轉／金鑰」，授權中心是「我登入了哪個帳號」。
 */
export function GlobalProvidersPage({
  focusProviderId,
  onFocusHandled,
}: {
  /** 從 Agent 頁的「管理全域供應商」進來時要直接打開的那一家 */
  focusProviderId?: string | null;
  onFocusHandled?: () => void;
} = {}) {
  const { t } = useTranslation();
  const description = t("globalProviders.description", {
    defaultValue:
      "集中管理跨 Agent 共用的 API Key 與 Endpoint；再選擇要提供給哪些 Agent。",
  });

  return (
    <>
      <AppPageHeader
        icon={<Boxes className="h-5 w-5" strokeWidth={1.6} />}
        title={t("nav.globalProviders", { defaultValue: "全域供應商" })}
      />
      <div
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto scroll-stable"
      >
        <div className="px-6 pb-10 pt-4">
          <p className="m-0 mb-3 max-w-[720px] text-caption text-fg-2">
            {description}
          </p>
          <GlobalSupplierAccounts
            initialDetailId={focusProviderId}
            onInitialDetailHandled={onFocusHandled}
          />
        </div>
      </div>
    </>
  );
}
