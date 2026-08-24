/**
 * git2im - GitHub to IM Notification Gateway
 *
 * Cloudflare Worker 主入口与调度核心
 *
 * 核心设计原则：
 * 1. 纯原生 Web Standards API 与轻量级 Router，零外部 Web 框架。
 * 2. 4 步无状态 Webhook 流转管道：验签/幂等 -> 标准化 -> 路由去重 -> 多平台并发投递。
 * 3. D1 为唯一 Source of Truth，AES-256-GCM 保护业务凭据。
 */

import type { Env } from "./env";
import { Router } from "./http/router";
import { jsonSuccess, jsonError } from "./http/response";
import { requireAdminAuth } from "./http/admin-auth";
import { parseGithubWebhookHeaders, readBodyLimited } from "./github/headers";
import { verifyGithubSignature } from "./github/signature";
import { parseGithubEvent } from "./github/parser";
import { getAcceptedGithubWebhookSecrets } from "./security/secret-store";
import { atomicRegisterEvent, updateEventFinished } from "./storage/events";
import { insertDelivery } from "./storage/deliveries";
import { listRoutes } from "./config/routes";
import { resolveRoutes } from "./notification/route-matcher";
import { buildNotification } from "./notification/builder";
import { getTargetById } from "./config/targets";
import { dispatchNotificationToTargets } from "./channels/dispatcher";
import { runScheduledCleanup } from "./scheduled/cleanup";

// API 处理器引入
import { handleLogin, handleLogout, handleAuthMe } from "./api/auth";
import {
  handleListTargets,
  handleCreateTarget,
  handleGetTarget,
  handleUpdateTarget,
  handleDeleteTarget,
  handleTestTarget,
} from "./api/targets";
import {
  handleListRoutes,
  handleCreateRoute,
  handleGetRoute,
  handleUpdateRoute,
  handleDeleteRoute,
} from "./api/routes";
import {
  handleGetSettings,
  handleRotateGithubSecret,
} from "./api/settings";
import { handleGetStatsOverview, handleGetRecentFailures } from "./api/stats";
import { handleExport, handleImport } from "./api/export";

// 初始化路由实例
const router = new Router();

// 1. 健康检查端点
router.get("/health", async () => {
  return jsonSuccess({
    status: "ok",
    service: "git2im",
    timestamp: Date.now(),
  });
});

// 2. GitHub Webhook 核心管道入口 (POST /webhooks/github)
router.post("/webhooks/github", async (request, env) => {
  const startTime = Date.now();

  // Step 2.1: 请求头解析
  const headers = parseGithubWebhookHeaders(request);
  if (!headers) {
    return jsonError("MISSING_HEADERS", "Required GitHub headers (X-GitHub-Delivery, X-GitHub-Event) missing", 400);
  }

  // Step 2.2: 请求体大小安全限制 (1 MiB 上限)
  const { bodyBytes, bodyText, exceeded } = await readBodyLimited(request);
  if (exceeded) {
    return jsonError("PAYLOAD_TOO_LARGE", "Webhook body size exceeds 1 MiB limit", 413);
  }

  // Step 2.3: HMAC-SHA256 签名校验
  const candidateSecrets = await getAcceptedGithubWebhookSecrets(env.DB, env.MASTER_KEY);
  if (candidateSecrets.length > 0) {
    const isSignatureValid = await verifyGithubSignature(
      bodyBytes,
      headers.signature,
      candidateSecrets
    );

    if (!isSignatureValid) {
      return jsonError("UNAUTHORIZED", "Invalid GitHub webhook signature", 401);
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const deliveryId = headers.deliveryId;
  const eventType = headers.eventType;
  const repository = payload.repository?.full_name || "unknown";
  const actor = payload.sender?.login || "unknown";

  // Step 2.4: 基于 PRIMARY KEY 的原子幂等登记
  const registerResult = await atomicRegisterEvent(env.DB, {
    deliveryId,
    repository,
    eventType,
    actor,
    receivedAt: startTime,
  });

  if (!registerResult.isNew) {
    // 幂等拦截重复 Delivery
    return jsonSuccess({ ok: true, duplicate: true, message: "Delivery already processed" });
  }

  // Step 2.5: 事件解析与标准化
  const event = parseGithubEvent(deliveryId, eventType, payload);
  if (!event) {
    await updateEventFinished(env.DB, deliveryId, {
      status: "ignored",
      durationMs: Date.now() - startTime,
    });
    return jsonSuccess({ ok: true, ignored: true, message: "Event type not supported for routing" });
  }

  if (!event.shouldNotify) {
    await updateEventFinished(env.DB, deliveryId, {
      status: "ignored",
      durationMs: Date.now() - startTime,
    });

    if (event.type === "ping") {
      return jsonSuccess({ ok: true, message: "pong" });
    }
    return jsonSuccess({ ok: true, ignored: true, message: "Event ignored by policy" });
  }

  // Step 2.6: 路由匹配与 Target 去重解析
  const allRoutes = await listRoutes(env.DB);
  const { matchedRoutes, targetIds, fanoutExceeded } = resolveRoutes(event, allRoutes);

  if (fanoutExceeded) {
    await updateEventFinished(env.DB, deliveryId, {
      status: "internal_error",
      matchedRouteCount: matchedRoutes.length,
      errorSummary: "TARGET_FANOUT_LIMIT_EXCEEDED",
      durationMs: Date.now() - startTime,
    });
    return jsonError(
      "TARGET_FANOUT_LIMIT_EXCEEDED",
      "Resolved targets exceed maximum fan-out limit of 6",
      400
    );
  }

  if (matchedRoutes.length === 0 || targetIds.length === 0) {
    await updateEventFinished(env.DB, deliveryId, {
      status: "ignored",
      matchedRouteCount: 0,
      durationMs: Date.now() - startTime,
    });
    return jsonSuccess({ ok: true, matchedRoutes: 0, message: "No matching routes found" });
  }

  // Step 2.7: 加载有效 Target 配置
  const targets = (
    await Promise.all(targetIds.map((id) => getTargetById(env.DB, id)))
  ).filter((t): t is NonNullable<typeof t> => t !== null && t.enabled);

  if (targets.length === 0) {
    await updateEventFinished(env.DB, deliveryId, {
      status: "ignored",
      matchedRouteCount: matchedRoutes.length,
      durationMs: Date.now() - startTime,
    });
    return jsonSuccess({ ok: true, message: "All resolved targets are disabled or deleted" });
  }

  // Step 2.8: 构建通用通知模型并并发分发
  const notification = buildNotification(event);
  const deliveryResults = await dispatchNotificationToTargets(env, targets, notification);

  // Step 2.9: 记录投递详情与更新事件最终状态
  const anySuccess = deliveryResults.some((d) => d.success);
  const overallStatus = anySuccess ? "processed" : "internal_error";
  const durationMs = Date.now() - startTime;

  await Promise.all([
    ...deliveryResults.map((res) => {
      const targetObj = targets.find((t) => t.id === res.targetId);
      return insertDelivery(env.DB, {
        source: "github",
        eventId: deliveryId,
        targetId: res.targetId,
        targetName: targetObj?.name || "unknown",
        provider: res.provider,
        channelType: res.channelType,
        status: res.success ? "success" : "failed",
        httpStatus: res.httpStatus,
        providerCode: res.providerCode,
        errorCode: res.errorCode,
        errorSummary: res.errorSummary,
        durationMs: res.durationMs,
      });
    }),
    updateEventFinished(env.DB, deliveryId, {
      status: overallStatus,
      matchedRouteCount: matchedRoutes.length,
      durationMs,
    }),
  ]);

  return jsonSuccess({
    deliveryId,
    status: overallStatus,
    matchedRoutes: matchedRoutes.length,
    deliveredTargets: deliveryResults.length,
  });
});

// 3. 认证管理 API
router.post("/api/auth/login", handleLogin);
router.post("/api/auth/logout", handleLogout);
router.get("/api/auth/me", handleAuthMe);

// 4. Target 管理 API (需管理员权限)
router.get("/api/targets", requireAdminAuth(handleListTargets));
router.post("/api/targets", requireAdminAuth(handleCreateTarget));
router.get("/api/targets/:id", requireAdminAuth(handleGetTarget));
router.put("/api/targets/:id", requireAdminAuth(handleUpdateTarget));
router.delete("/api/targets/:id", requireAdminAuth(handleDeleteTarget));
router.post("/api/targets/:id/test", requireAdminAuth(handleTestTarget));

// 5. Route 管理 API (需管理员权限)
router.get("/api/routes", requireAdminAuth(handleListRoutes));
router.post("/api/routes", requireAdminAuth(handleCreateRoute));
router.get("/api/routes/:id", requireAdminAuth(handleGetRoute));
router.put("/api/routes/:id", requireAdminAuth(handleUpdateRoute));
router.delete("/api/routes/:id", requireAdminAuth(handleDeleteRoute));

// 6. Settings 管理 API (需管理员权限)
router.get("/api/settings", requireAdminAuth(handleGetSettings));
router.post("/api/settings/github/rotate", requireAdminAuth(handleRotateGithubSecret));

// 7. Stats 大盘统计 API (需管理员权限)
router.get("/api/stats/overview", requireAdminAuth(handleGetStatsOverview));
router.get("/api/stats/failures", requireAdminAuth(handleGetRecentFailures));

// 8. 导出与导入 API (需管理员权限)
router.get("/api/export", requireAdminAuth(handleExport));
router.post("/api/import", requireAdminAuth(handleImport));

export default {
  /**
   * HTTP Fetch 请求处理主入口
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // 优先执行服务端路由
    const response = await router.handle(request, env, ctx);
    if (response) {
      return response;
    }

    // 未命中服务端路由时，交由 Cloudflare Static Assets 托管前端静态页面
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return jsonError("NOT_FOUND", "Resource not found", 404);
  },

  /**
   * 定时调度任务入口 (Scheduled Cron Trigger)
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await runScheduledCleanup(env);
  },
};
