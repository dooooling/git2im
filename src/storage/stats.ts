/**
 * 大盘统计与多维数据聚合模块 (Dashboard Stats Aggregation)
 *
 * 核心指标与维度：
 * 1. 顶部 4 大核心指标：有效事件数、投递总数、成功投递数、失败数、总体成功率。
 * 2. 状态异常指标：长期处于 processing 状态 (> 5分钟) 的 Stale 事件数。
 * 3. 多维分布统计：
 *    - Event Type 分布 (push / pull_request / workflow_run / release)
 *    - Top 10 活跃 GitHub 仓库
 *    - Provider 维度统计 (飞书 / 钉钉 / 企微：投递次数、成功、失败、成功率、平均耗时)
 *    - Channel 维度统计 (feishu_webhook / feishu_app / dingtalk_webhook / wecom_webhook)
 *    - 趋势序列 (24h 按小时 / 7d与30d 按日)
 */

export type Timeframe = "24h" | "7d" | "30d";

export interface ProviderStatRow {
  provider: "feishu" | "dingtalk" | "wecom";
  attempts: number;
  success: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
}

export interface ChannelStatRow {
  channelType: string;
  attempts: number;
  success: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
}

export interface EventTypeStatRow {
  eventType: string;
  count: number;
  percentage: number;
}

export interface RepositoryStatRow {
  repository: string;
  count: number;
}

export interface TrendPoint {
  timeLabel: string;
  timestamp: number;
  success: number;
  failed: number;
}

export interface DashboardOverviewStats {
  timeframe: Timeframe;
  sinceTimestamp: number;
  nowTimestamp: number;

  /** 核心卡片指标 */
  validEvents: number;
  totalDeliveries: number;
  successDeliveries: number;
  failedDeliveries: number;
  successRate: number;
  staleProcessingCount: number;

  /** 趋势与分布图表数据 */
  trend: TrendPoint[];
  eventTypes: EventTypeStatRow[];
  topRepositories: RepositoryStatRow[];
  providers: ProviderStatRow[];
  channels: ChannelStatRow[];
}

/**
 * 根据 Timeframe 计算起始时间戳 (毫秒)
 */
export function calculateSinceTimestamp(timeframe: Timeframe, now = Date.now()): number {
  switch (timeframe) {
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
  }
}

/**
 * 获取管理大盘全量聚合统计数据
 *
 * @param db Cloudflare D1 实例
 * @param timeframe 时间范围 ("24h" | "7d" | "30d")
 * @param now 可选当前基准时间（用于测试固定时间）
 */
export async function getDashboardStats(
  db: D1Database,
  timeframe: Timeframe = "24h",
  now = Date.now()
): Promise<DashboardOverviewStats> {
  const since = calculateSinceTimestamp(timeframe, now);
  const staleThreshold = now - 5 * 60 * 1000; // 超过 5 分钟未完成记为 stale

  // 1. 核心指标聚合查询
  const summaryPromise = db
    .prepare(
      `SELECT
        COUNT(*) AS totalDeliveries,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successDeliveries,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failedDeliveries
       FROM deliveries
       WHERE source = 'github' AND created_at >= ?`
    )
    .bind(since)
    .first<{
      totalDeliveries: number;
      successDeliveries: number;
      failedDeliveries: number;
    }>();

  // 2. 有效事件数查询
  const validEventsPromise = db
    .prepare(`SELECT COUNT(*) AS count FROM events WHERE received_at >= ?`)
    .bind(since)
    .first<{ count: number }>();

  // 3. Stale Processing 计数
  const staleEventsPromise = db
    .prepare(`SELECT COUNT(*) AS count FROM events WHERE status = 'processing' AND received_at < ?`)
    .bind(staleThreshold)
    .first<{ count: number }>();

  // 4. Event Type 分布
  const eventTypesPromise = db
    .prepare(
      `SELECT event_type AS eventType, COUNT(*) AS count
       FROM events
       WHERE received_at >= ?
       GROUP BY event_type
       ORDER BY count DESC`
    )
    .bind(since)
    .all<{ eventType: string; count: number }>();

  // 5. Top 10 Repositories
  const topReposPromise = db
    .prepare(
      `SELECT repository, COUNT(*) AS count
       FROM events
       WHERE received_at >= ?
       GROUP BY repository
       ORDER BY count DESC
       LIMIT 10`
    )
    .bind(since)
    .all<{ repository: string; count: number }>();

  // 6. Provider 表现矩阵
  const providersPromise = db
    .prepare(
      `SELECT
        provider,
        COUNT(*) AS attempts,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(AVG(duration_ms), 0) AS avgDurationMs
       FROM deliveries
       WHERE source = 'github' AND created_at >= ?
       GROUP BY provider
       ORDER BY attempts DESC`
    )
    .bind(since)
    .all<{
      provider: "feishu" | "dingtalk" | "wecom";
      attempts: number;
      success: number;
      failed: number;
      avgDurationMs: number;
    }>();

  // 7. Channel 表现矩阵
  const channelsPromise = db
    .prepare(
      `SELECT
        channel_type AS channelType,
        COUNT(*) AS attempts,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(AVG(duration_ms), 0) AS avgDurationMs
       FROM deliveries
       WHERE source = 'github' AND created_at >= ?
       GROUP BY channel_type
       ORDER BY attempts DESC`
    )
    .bind(since)
    .all<{
      channelType: string;
      attempts: number;
      success: number;
      failed: number;
      avgDurationMs: number;
    }>();

  // 并行执行所有基础查询
  const [
    summaryRow,
    validEventsRow,
    staleEventsRow,
    eventTypesRes,
    topReposRes,
    providersRes,
    channelsRes,
  ] = await Promise.all([
    summaryPromise,
    validEventsPromise,
    staleEventsPromise,
    eventTypesPromise,
    topReposPromise,
    providersPromise,
    channelsPromise,
  ]);

  const totalDeliveries = summaryRow?.totalDeliveries ?? 0;
  const successDeliveries = summaryRow?.successDeliveries ?? 0;
  const failedDeliveries = summaryRow?.failedDeliveries ?? 0;
  const validEvents = validEventsRow?.count ?? 0;
  const staleProcessingCount = staleEventsRow?.count ?? 0;

  const successRate =
    totalDeliveries > 0
      ? Number(((successDeliveries / totalDeliveries) * 100).toFixed(2))
      : 100;

  // 整理 Event Type 占比
  const eventTypes: EventTypeStatRow[] = eventTypesRes.results.map((r) => ({
    eventType: r.eventType,
    count: r.count,
    percentage: validEvents > 0 ? Number(((r.count / validEvents) * 100).toFixed(1)) : 0,
  }));

  // 整理 Provider 列表
  const providers: ProviderStatRow[] = providersRes.results.map((r) => ({
    provider: r.provider,
    attempts: r.attempts,
    success: r.success,
    failed: r.failed,
    successRate:
      r.attempts > 0 ? Number(((r.success / r.attempts) * 100).toFixed(2)) : 100,
    avgDurationMs: Math.round(r.avgDurationMs),
  }));

  // 整理 Channel 列表
  const channels: ChannelStatRow[] = channelsRes.results.map((r) => ({
    channelType: r.channelType,
    attempts: r.attempts,
    success: r.success,
    failed: r.failed,
    successRate:
      r.attempts > 0 ? Number(((r.success / r.attempts) * 100).toFixed(2)) : 100,
    avgDurationMs: Math.round(r.avgDurationMs),
  }));

  // 8. 趋势图数据聚合
  const trend = await generateTrendPoints(db, timeframe, since, now);

  return {
    timeframe,
    sinceTimestamp: since,
    nowTimestamp: now,
    validEvents,
    totalDeliveries,
    successDeliveries,
    failedDeliveries,
    successRate,
    staleProcessingCount,
    trend,
    eventTypes,
    topRepositories: topReposRes.results,
    providers,
    channels,
  };
}

/**
 * 聚合生成趋势折线图点集
 */
async function generateTrendPoints(
  db: D1Database,
  timeframe: Timeframe,
  since: number,
  now: number
): Promise<TrendPoint[]> {
  // 根据时间跨度划分时间桶
  const isHourly = timeframe === "24h";
  const bucketMs = isHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const numBuckets = isHourly ? 24 : timeframe === "7d" ? 7 : 30;

  // 查询在时间范围内的投递记录时间与状态
  const deliveries = await db
    .prepare(
      `SELECT created_at AS createdAt, status
       FROM deliveries
       WHERE source = 'github' AND created_at >= ?
       ORDER BY created_at ASC`
    )
    .bind(since)
    .all<{ createdAt: number; status: string }>();

  const points: TrendPoint[] = [];

  // 初始化连续时间桶，保证无数据的点显示 0 而不是断点
  for (let i = numBuckets - 1; i >= 0; i--) {
    const bucketStart = now - (i + 1) * bucketMs;
    const bucketEnd = now - i * bucketMs;

    const date = new Date(bucketEnd);
    const timeLabel = isHourly
      ? `${date.getUTCHours().toString().padStart(2, "0")}:00`
      : `${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;

    let success = 0;
    let failed = 0;

    for (const d of deliveries.results) {
      if (d.createdAt >= bucketStart && d.createdAt < bucketEnd) {
        if (d.status === "success") success++;
        if (d.status === "failed") failed++;
      }
    }

    points.push({
      timeLabel,
      timestamp: bucketEnd,
      success,
      failed,
    });
  }

  return points;
}
