/**
 * Cloudflare Worker 环境变量与 Bindings 类型定义
 */

export interface Env {
  /** Cloudflare D1 关系型数据库绑定 (业务唯一 Source of Truth) */
  DB: D1Database;

  /** 静态资源托管 Fetcher (用于托管 public/ 目录下的原生前端) */
  ASSETS: Fetcher;

  /** 管理端登录防暴力破解速率限制器 */
  LOGIN_RATE_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };

  /** 管理后台管理员密码 (由 Cloudflare Secret 注入，不存入 D1) */
  ADMIN_PASSWORD: string;

  /** AES-256-GCM 根主密钥 (Base64 编码的 32 字节密钥，由 Cloudflare Secret 注入) */
  MASTER_KEY: string;

  /** 可选：网关版本标识 */
  VERSION?: string;
}
