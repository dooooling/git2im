/**
 * 管理端鉴权与 Session 控制器 (Auth Controller)
 *
 * 核心安全规范：
 * 1. 登录验证采用恒定时间比对 ADMIN_PASSWORD。
 * 2. 签发 HMAC-SHA256 Session Token，通过 HttpOnly + Secure + SameSite=Strict Cookie 传输。
 * 3. 接入 Cloudflare RateLimiter 限制爆破尝试。
 */

import type { RouteHandler } from "../http/router";
import { jsonSuccess, jsonError } from "../http/response";
import { timingSafeEqual } from "../security/constant-time";
import {
  createSessionToken,
  verifySessionToken,
  parseSessionCookie,
  serializeSessionCookie,
  serializeClearSessionCookie,
} from "../security/session";

/**
 * POST /api/auth/login
 */
export const handleLogin: RouteHandler = async (request, env) => {
  const ip = request.headers.get("CF-Connecting-IP") || "127.0.0.1";

  // 1. Rate Limiter 防爆破限制 (10 次/分钟)
  if (env.LOGIN_RATE_LIMITER) {
    try {
      const { success } = await env.LOGIN_RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return jsonError("TOO_MANY_REQUESTS", "Too many failed login attempts, please try again later", 429);
      }
    } catch {
      // 忽略本地测试时可能缺失 binding 的情况
    }
  }

  let body: { password?: string } = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON payload", 400);
  }

  const providedPassword = body.password || "";
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return jsonError("SERVER_MISCONFIGURED", "ADMIN_PASSWORD is not configured in environment", 500);
  }

  // 2. 恒定时间比对密码
  const isMatch = timingSafeEqual(providedPassword, adminPassword);
  if (!isMatch) {
    return jsonError("INVALID_CREDENTIALS", "Incorrect admin password", 401);
  }

  // 3. 签发 Session Token
  const token = await createSessionToken(env.MASTER_KEY);
  const cookie = serializeSessionCookie(token);

  return jsonSuccess(
    { message: "Login successful" },
    200,
    { "Set-Cookie": cookie }
  );
};

/**
 * POST /api/auth/logout
 */
export const handleLogout: RouteHandler = async () => {
  const cookie = serializeClearSessionCookie();
  return jsonSuccess(
    { message: "Logged out" },
    200,
    { "Set-Cookie": cookie }
  );
};

/**
 * GET /api/auth/me
 */
export const handleAuthMe: RouteHandler = async (request, env) => {
  const cookieHeader = request.headers.get("Cookie");
  const token = parseSessionCookie(cookieHeader);

  if (!token) {
    return jsonSuccess({ authenticated: false });
  }

  const result = await verifySessionToken(token, env.MASTER_KEY);
  return jsonSuccess({
    authenticated: result.valid,
  });
};
