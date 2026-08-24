/**
 * 系统设置管理 REST API 控制器 (Settings Controller)
 */

import type { RouteHandler } from "../http/router";
import { jsonSuccess, jsonError } from "../http/response";
import { getSystemSettings } from "../config/settings";
import { rotateGithubWebhookSecret } from "../security/secret-store";

/**
 * GET /api/settings
 */
export const handleGetSettings: RouteHandler = async (_req, env) => {
  const settings = await getSystemSettings(env.DB);
  return jsonSuccess(settings);
};

/**
 * POST /api/settings/github/rotate
 * 轮换 GitHub Webhook Secret，仅此一次回显新生成的 Secret 明文
 */
export const handleRotateGithubSecret: RouteHandler = async (_req, env) => {
  try {
    const result = await rotateGithubWebhookSecret(env.DB, env.MASTER_KEY);
    return jsonSuccess({
      newSecret: result.newSecret,
      previousExpiresAt: result.expiresAt,
      message: "GitHub Webhook Secret rotated successfully. Please copy the new secret now, it will not be displayed again.",
    });
  } catch (err: any) {
    return jsonError("SECRET_ROTATE_ERROR", err.message || "Failed to rotate GitHub secret", 500);
  }
};
