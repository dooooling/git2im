/**
 * Target 管理与测试 REST API 控制器 (Targets Controller)
 */

import type { RouteHandler } from "../http/router";
import { jsonSuccess, jsonError } from "../http/response";
import {
  listTargets,
  getTargetById,
  createTarget,
  updateTarget,
  deleteTarget,
  type CreateTargetInput,
  type UpdateTargetInput,
} from "../config/targets";
import { getNotificationChannel } from "../channels/registry";
import { insertDelivery } from "../storage/deliveries";

/**
 * GET /api/targets
 */
export const handleListTargets: RouteHandler = async (_req, env) => {
  const targets = await listTargets(env.DB);
  return jsonSuccess(targets);
};

/**
 * POST /api/targets
 */
export const handleCreateTarget: RouteHandler = async (request, env) => {
  let body: CreateTargetInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON payload", 400);
  }

  if (!body.name || !body.type) {
    return jsonError("VALIDATION_ERROR", "Target name and type are required", 400);
  }

  const validTypes = ["feishu_webhook", "feishu_app", "dingtalk_webhook", "wecom_webhook"];
  if (!validTypes.includes(body.type)) {
    return jsonError("VALIDATION_ERROR", `Invalid channel type: ${body.type}`, 400);
  }

  try {
    const created = await createTarget(env.DB, env.MASTER_KEY, body);
    return jsonSuccess(created, 201);
  } catch (err: any) {
    return jsonError("TARGET_CREATE_ERROR", err.message || "Failed to create target", 400);
  }
};

/**
 * GET /api/targets/:id
 */
export const handleGetTarget: RouteHandler = async (_req, env, params) => {
  const targetId = params.id;
  if (!targetId) {
    return jsonError("BAD_REQUEST", "Target ID required", 400);
  }

  const targets = await listTargets(env.DB);
  const target = targets.find((t) => t.id === targetId);

  if (!target) {
    return jsonError("NOT_FOUND", "Target not found", 404);
  }

  return jsonSuccess(target);
};

/**
 * PUT /api/targets/:id
 */
export const handleUpdateTarget: RouteHandler = async (request, env, params) => {
  const targetId = params.id;
  if (!targetId) {
    return jsonError("BAD_REQUEST", "Target ID required", 400);
  }

  let body: UpdateTargetInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_REQUEST", "Invalid JSON payload", 400);
  }

  try {
    const updated = await updateTarget(env.DB, env.MASTER_KEY, targetId, body);
    return jsonSuccess(updated);
  } catch (err: any) {
    return jsonError("TARGET_UPDATE_ERROR", err.message || "Failed to update target", 400);
  }
};

/**
 * DELETE /api/targets/:id
 */
export const handleDeleteTarget: RouteHandler = async (_req, env, params) => {
  const targetId = params.id;
  if (!targetId) {
    return jsonError("BAD_REQUEST", "Target ID required", 400);
  }

  try {
    await deleteTarget(env.DB, targetId);
    return jsonSuccess({ message: "Target deleted successfully" });
  } catch (err: any) {
    return jsonError("TARGET_DELETE_ERROR", err.message || "Failed to delete target", 400);
  }
};

/**
 * POST /api/targets/:id/test
 * 触发连通性测试并写入 deliveries (source = 'test')
 */
export const handleTestTarget: RouteHandler = async (_req, env, params) => {
  const targetId = params.id;
  if (!targetId) {
    return jsonError("BAD_REQUEST", "Target ID required", 400);
  }

  const target = await getTargetById(env.DB, targetId);
  if (!target) {
    return jsonError("NOT_FOUND", "Target not found", 404);
  }

  const channel = getNotificationChannel(target.type);
  if (!channel) {
    return jsonError("CHANNEL_NOT_SUPPORTED", `Channel type ${target.type} is not supported`, 400);
  }

  const result = await channel.test(env, target);

  // 记录测试投递结果到 deliveries 表
  await insertDelivery(env.DB, {
    source: "test",
    targetId: target.id,
    targetName: target.name,
    provider: result.provider,
    channelType: result.channelType,
    status: result.success ? "success" : "failed",
    httpStatus: result.httpStatus,
    providerCode: result.providerCode,
    errorCode: result.errorCode,
    errorSummary: result.errorSummary,
    durationMs: result.durationMs,
  });

  return jsonSuccess(result);
};
