/**
 * 投递记录持久化模块 (Deliveries Storage)
 *
 * 记录每一次向具体 Target 发送通知的执行结果，支持：
 * 1. 记录真实 GitHub 事件的投递与管理端测试发送结果；
 * 2. 保存 Target 名称与 Provider 快照（即使 Target 随后被删除，历史投递记录仍可溯源）；
 * 3. 统计最近失败记录 (Recent Failures) 与 Target 最近测试状态。
 */

import { sanitizeErrorSummary } from "../security/redact";

export type DeliverySource = "github" | "test";
export type DeliveryProvider = "feishu" | "dingtalk" | "wecom";
export type DeliveryChannelType =
  | "feishu_webhook"
  | "feishu_app"
  | "dingtalk_webhook"
  | "wecom_webhook";
export type DeliveryStatus = "success" | "failed";

export interface DeliveryRecord {
  id: string;
  event_id: string | null;
  source: DeliverySource;
  target_id: string | null;
  target_name: string;
  provider: DeliveryProvider;
  channel_type: DeliveryChannelType;
  status: DeliveryStatus;
  http_status: number | null;
  provider_code: string | null;
  error_code: string | null;
  error_summary: string | null;
  duration_ms: number;
  created_at: number;
}

export interface InsertDeliveryInput {
  id?: string;
  eventId?: string | null;
  source?: DeliverySource;
  targetId?: string | null;
  targetName: string;
  provider: DeliveryProvider;
  channelType: DeliveryChannelType;
  status: DeliveryStatus;
  httpStatus?: number | null;
  providerCode?: string | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  durationMs: number;
  createdAt?: number;
}

export interface RecentFailureItem {
  id: string;
  eventId: string | null;
  repository: string | null;
  eventType: string | null;
  targetName: string;
  provider: DeliveryProvider;
  channelType: DeliveryChannelType;
  httpStatus: number | null;
  providerCode: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  durationMs: number;
  createdAt: number;
}

/**
 * 记录单次通知投递结果
 *
 * @param db Cloudflare D1 实例
 * @param input 投递详情
 * @returns 生成的 delivery ID
 */
export async function insertDelivery(
  db: D1Database,
  input: InsertDeliveryInput
): Promise<string> {
  const deliveryId = input.id ?? crypto.randomUUID();
  const createdAt = input.createdAt ?? Date.now();
  const source = input.source ?? (input.eventId ? "github" : "test");

  // 严格执行错误摘要脱敏
  const sanitizedSummary = input.errorSummary
    ? sanitizeErrorSummary(input.errorSummary, 256)
    : null;

  await db
    .prepare(
      `INSERT INTO deliveries (
        id, event_id, source, target_id, target_name,
        provider, channel_type, status, http_status,
        provider_code, error_code, error_summary,
        duration_ms, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      deliveryId,
      input.eventId ?? null,
      source,
      input.targetId ?? null,
      input.targetName,
      input.provider,
      input.channelType,
      input.status,
      input.httpStatus ?? null,
      input.providerCode ?? null,
      input.errorCode ?? null,
      sanitizedSummary,
      Math.max(0, input.durationMs),
      createdAt
    )
    .run();

  return deliveryId;
}

/**
 * 获取最近发生的投递失败列表 (最多 limit 条，默认 20)
 */
export async function getRecentFailures(
  db: D1Database,
  limit = 20
): Promise<RecentFailureItem[]> {
  const query = `
    SELECT
      d.id,
      d.event_id AS eventId,
      e.repository AS repository,
      e.event_type AS eventType,
      d.target_name AS targetName,
      d.provider,
      d.channel_type AS channelType,
      d.http_status AS httpStatus,
      d.provider_code AS providerCode,
      d.error_code AS errorCode,
      d.error_summary AS errorSummary,
      d.duration_ms AS durationMs,
      d.created_at AS createdAt
    FROM deliveries d
    LEFT JOIN events e ON d.event_id = e.id
    WHERE d.status = 'failed'
    ORDER BY d.created_at DESC
    LIMIT ?
  `;

  const result = await db.prepare(query).bind(limit).all<RecentFailureItem>();
  return result.results;
}

/**
 * 获取指定 Target 最近一次的测试发送结果 (source = 'test')
 */
export async function getLastTargetTestDelivery(
  db: D1Database,
  targetId: string
): Promise<{
  lastTestAt: number;
  lastTestStatus: DeliveryStatus;
  lastTestDurationMs: number;
  errorSummary: string | null;
} | null> {
  const query = `
    SELECT
      created_at AS lastTestAt,
      status AS lastTestStatus,
      duration_ms AS lastTestDurationMs,
      error_summary AS errorSummary
    FROM deliveries
    WHERE source = 'test' AND target_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const row = await db.prepare(query).bind(targetId).first<{
    lastTestAt: number;
    lastTestStatus: DeliveryStatus;
    lastTestDurationMs: number;
    errorSummary: string | null;
  }>();

  return row ?? null;
}

/**
 * 清理指定截止时间之前的旧投递记录 (默认 30 天)
 */
export async function cleanupOldDeliveries(
  db: D1Database,
  cutoffTimestamp: number
): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM deliveries WHERE created_at < ?`)
    .bind(cutoffTimestamp)
    .run();

  return result.meta.changes ?? 0;
}
