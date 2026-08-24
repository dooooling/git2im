/**
 * GitHub 事件持久化操作模块 (Events Storage)
 *
 * 核心规范：
 * 1. 使用 events 表的 PRIMARY KEY (id) 约束实现原子幂等性 (INSERT ... ON CONFLICT DO NOTHING)。
 * 2. 严禁持久化存储 GitHub 原始 Payload、Commit Diff 等敏感隐私内容。
 * 3. 仅记录交付元数据与状态摘要，默认保留 30 天。
 */

export interface RegisterEventInput {
  deliveryId: string;
  repository: string;
  eventType: string;
  actor?: string;
  branch?: string;
  receivedAt?: number;
}

export interface UpdateEventFinishedInput {
  status: "processed" | "ignored" | "failed" | "internal_error";
  matchedRouteCount?: number;
  durationMs?: number;
  errorCode?: string;
  errorSummary?: string;
  completedAt?: number;
}

export interface EventDbRecord {
  id: string;
  repository: string;
  event_type: string;
  actor: string;
  branch: string | null;
  status: string;
  matched_route_count: number;
  duration_ms: number | null;
  error_code: string | null;
  error_summary: string | null;
  received_at: number;
  completed_at: number | null;
}

/**
 * 基于 D1 PRIMARY KEY 进行原子幂等登记
 *
 * @param db Cloudflare D1 数据库实例
 * @param input 接收到的 GitHub Webhook 基础元数据
 * @returns { isNew: boolean, eventId: string } 若为新事件 isNew 为 true，若为重复事件 isNew 为 false
 */
export async function atomicRegisterEvent(
  db: D1Database,
  input: RegisterEventInput
): Promise<{ isNew: boolean; eventId: string }> {
  const receivedAt = input.receivedAt ?? Date.now();

  // 依赖 INSERT INTO ... ON CONFLICT(id) DO NOTHING 实现原子幂等
  const result = await db
    .prepare(
      `INSERT INTO events (
        id, repository, event_type, actor, branch, status,
        matched_route_count, received_at
      )
      VALUES (?, ?, ?, ?, ?, 'processing', 0, ?)
      ON CONFLICT(id) DO NOTHING`
    )
    .bind(
      input.deliveryId,
      input.repository,
      input.eventType,
      input.actor ?? "unknown",
      input.branch ?? null,
      receivedAt
    )
    .run();

  const isNew = result.meta.changes === 1;

  return {
    isNew,
    eventId: input.deliveryId,
  };
}

/**
 * 更新事件最终完成状态及执行耗时
 */
export async function updateEventFinished(
  db: D1Database,
  deliveryId: string,
  input: UpdateEventFinishedInput
): Promise<void> {
  const completedAt = input.completedAt ?? Date.now();

  await db
    .prepare(
      `UPDATE events
       SET status = ?,
           matched_route_count = ?,
           completed_at = ?,
           duration_ms = ?,
           error_code = ?,
           error_summary = ?
       WHERE id = ?`
    )
    .bind(
      input.status,
      input.matchedRouteCount ?? 0,
      completedAt,
      input.durationMs ?? null,
      input.errorCode ?? null,
      input.errorSummary ?? null,
      deliveryId
    )
    .run();
}

/**
 * 根据 Delivery ID 获取单个事件记录
 */
export async function getEventById(
  db: D1Database,
  deliveryId: string
): Promise<EventDbRecord | null> {
  return await db
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .bind(deliveryId)
    .first<EventDbRecord>();
}

/**
 * 清理指定截止时间戳之前的历史事件数据
 */
export async function cleanupOldEvents(
  db: D1Database,
  cutoffTimestamp: number
): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM events WHERE received_at < ?`)
    .bind(cutoffTimestamp)
    .run();

  return result.meta.changes ?? 0;
}
