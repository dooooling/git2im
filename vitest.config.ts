import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * Vitest 测试配置
 *
 * 使用 Cloudflare 官方 @cloudflare/vitest-plugin 在 Workers Runtime 环境中运行测试
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          ADMIN_PASSWORD: "test-admin-password",
          MASTER_KEY: "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=",
          VERSION: "1.0.0-test",
        },
      },
    }),
  ],
  test: {
    // 启用全局测试函数 (describe, it, expect, beforeEach 等)
    globals: true,
    // 超时时间
    testTimeout: 10000,
    // 覆盖率收集配置
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/env.ts", "src/**/*.d.ts"],
    },
  },
});
