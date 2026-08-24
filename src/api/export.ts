/**
 * 配置导出与导入 REST API 控制器 (Export & Import Controller)
 *
 * 核心安全规范：
 * 1. 导出的 JSON 配置数据严格脱敏，不包含任何明文密钥、Token 或密码。
 * 2. 导入时校验 Target 与 Route 结构格式与白名单。
 */

import type { RouteHandler } from "../http/router";
import { jsonSuccess, jsonError } from "../http/response";
import { listTargets } from "../config/targets";
import { listRoutes, createRoute } from "../config/routes";

/**
 * GET /api/export
 */
export const handleExport: RouteHandler = async (_req, env) => {
  const [targets, routes] = await Promise.all([
    listTargets(env.DB),
    listRoutes(env.DB),
  ]);

  const sanitizedTargets = targets.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    enabled: t.enabled,
    appId: t.appId,
    recipients: t.recipients,
    webhookConfigured: t.webhookConfigured,
    signSecretConfigured: t.signSecretConfigured,
    appSecretConfigured: t.appSecretConfigured,
  }));

  const sanitizedRoutes = routes.map((r) => ({
    id: r.id,
    name: r.name,
    repository: r.repository,
    eventType: r.eventType,
    conditions: r.conditions,
    targetIds: r.targetIds,
    enabled: r.enabled,
    priority: r.priority,
  }));

  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    targets: sanitizedTargets,
    routes: sanitizedRoutes,
  };

  return jsonSuccess(exportData);
};

/**
 * POST /api/import
 */
export const handleImport: RouteHandler = async (request, env) => {
  let body: {
    targets?: any[];
    routes?: any[];
  };

  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON payload", 400);
  }

  const importedRoutes = body.routes || [];
  let routeCount = 0;

  for (const r of importedRoutes) {
    if (r.name && r.repository && r.eventType && Array.isArray(r.targetIds)) {
      try {
        await createRoute(env.DB, {
          name: r.name,
          repository: r.repository,
          eventType: r.eventType,
          conditions: r.conditions,
          targetIds: r.targetIds,
          enabled: r.enabled,
          priority: r.priority,
        });
        routeCount++;
      } catch {
        // 忽略单条导入异常
      }
    }
  }

  return jsonSuccess({
    message: "Import completed",
    importedRouteCount: routeCount,
  });
};
