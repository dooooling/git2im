/**
 * 飞书企业自建应用 Access Token 获取与多 App 隔离内存缓存模块
 *
 * 核心规范：
 * 1. 采用 Map<appId, TokenCache> 支持 N:N 多套不同飞书自建应用凭据。
 * 2. 自动在 Token 到期前 5 分钟安全刷新，避免重复网络调用。
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

const memoryTokenCacheMap = new Map<string, TokenCache>();

/**
 * 获取飞书租户凭证 (tenant_access_token)
 *
 * @param appId 飞书 App ID (cli_xxx)
 * @param appSecret 飞书 App Secret
 * @returns tenant_access_token 字符串
 */
export async function getFeishuTenantAccessToken(
  appId: string,
  appSecret: string
): Promise<{ token: string; expiresIn: number }> {
  const now = Date.now();
  const cached = memoryTokenCacheMap.get(appId);

  // 1. 若内存缓存仍然有效，直接复用
  if (cached && cached.expiresAt > now) {
    return {
      token: cached.token,
      expiresIn: Math.floor((cached.expiresAt - now) / 1000),
    };
  }

  // 2. 调用飞书官方接口换取新 Token
  const tokenUrl = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    throw new Error(`Feishu token HTTP error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`Feishu token API error: ${json.msg || `code ${json.code}`}`);
  }

  const expiresIn = json.expire || 7200; // 飞书默认 2 小时
  // 提前 5 分钟失效，保证调用安全
  const safeTtlMs = Math.max(60, expiresIn - 300) * 1000;

  memoryTokenCacheMap.set(appId, {
    token: json.tenant_access_token,
    expiresAt: now + safeTtlMs,
  });

  return {
    token: json.tenant_access_token,
    expiresIn,
  };
}

/**
 * 用于测试环境重置 Token 缓存
 */
export function resetFeishuTokenCache(appId?: string): void {
  if (appId) {
    memoryTokenCacheMap.delete(appId);
  } else {
    memoryTokenCacheMap.clear();
  }
}
