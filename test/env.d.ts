import type { Env as AppEnv } from "../src/env";

declare global {
  namespace Cloudflare {
    // 扩展测试环境中 cloudflare:test 的 Env 类型定义
    interface Env extends AppEnv {}
  }
}
