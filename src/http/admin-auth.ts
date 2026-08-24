/**
 * 管理端鉴权中间件与 CSRF 防御 (Admin Auth Middleware)
 *
 * 核心规范：
 * 1. 验证请求中的 gim_session Cookie 合法性与过期时间。
 * 2. 对所有写操作 (POST/PUT/DELETE) 校验 Origin 请求头，严禁跨站请求伪造 (CSRF)。
 */

import type { RouteHandler } from "./router";
import { jsonError } from "./response";
import { parseSessionCookie, verifySessionToken } from "../security/session";

/**
 * 包装需要管理员权限的 RouteHandler
 */
export function requireAdminAuth(handler: RouteHandler): RouteHandler {
  return async (request, env, params, ctx) => {
    // 1. 解析并校验 Session Cookie
    const cookieHeader = request.headers.get("Cookie");
    const token = parseSessionCookie(cookieHeader);

    if (!token) {
      return jsonError("UNAUTHORIZED", "Authentication required", 401);
    }

    const verifyResult = await verifySessionToken(token, env.MASTER_KEY);
    if (!verifyResult.valid) {
      return jsonError("UNAUTHORIZED", "Session invalid or expired", 401);
    }

    // 2. CSRF 防护校验（针对 POST, PUT, DELETE 写操作）
    const method = request.method.toUpperCase();
    if (["POST", "PUT", "DELETE"].includes(method)) {
      const origin = request.headers.get("Origin");
      const requestUrl = new URL(request.url);

      if (origin) {
        try {
          const originUrl = new URL(origin);
          if (originUrl.origin !== requestUrl.origin) {
            return jsonError("CSRF_FORBIDDEN", "Cross-origin requests are forbidden", 403);
          }
        } catch {
          return jsonError("CSRF_FORBIDDEN", "Invalid Origin header", 403);
        }
      }
    }

    // 3. 鉴权通过，执行下游业务处理器
    return await handler(request, env, params, ctx);
  };
}
