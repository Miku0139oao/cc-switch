import path from "node:path";
import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 不超訂：本機 24 核用 4 個 fork，CI 4 核用 3 個，2 核用 1 個。
// 預設的 CPU-1 在開發機上會開到 ~23 個 fork，讓幾支慢測試（App integration、
// AppsPage、PiProviderForm）在 5–10 秒上限下因資源飢餓逾時。
const maxForks = Math.max(1, Math.min(4, availableParallelism() - 1));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["{src,tests}/**/*.{test,spec}.{ts,tsx,js,jsx}"],
    environment: "jsdom",
    setupFiles: ["./tests/setupGlobals.ts", "./tests/setupTests.ts"],
    globals: true,
    // 不超訂：本機 24 核用 4 個 fork，CI 4 核用 3 個，2 核用 1 個。
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks,
      },
    },
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
