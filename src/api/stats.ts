/**
 * 大盘统计与失败排查 REST API 控制器 (Stats Controller)
 */

import type { RouteHandler } from "../http/router";
import { jsonSuccess, jsonError } from "../http/response";
import { getDashboardStats, type Timeframe } from "../storage/stats";
import { getRecentFailures } from "../storage/deliveries";

/**
 * GET /api/stats/overview?timeframe=24h|7d|30d
 */
export const handleGetStatsOverview: RouteHandler = async (request, env) => {
  const url = new URL(request.url);
  const rawTimeframe = (url.searchParams.get("timeframe") || "24h").toLowerCase();

  const validTimeframes: Timeframe[] = ["24h", "7d", "30d"];
  if (!validTimeframes.includes(rawTimeframe as Timeframe)) {
    return jsonError("BAD_REQUEST", "Invalid timeframe parameter. Must be '24h', '7d', or '30d'", 400);
  }

  const stats = await getDashboardStats(env.DB, rawTimeframe as Timeframe);
  return jsonSuccess(stats);
};

/**
 * GET /api/stats/failures?limit=20
 */
export const handleGetRecentFailures: RouteHandler = async (request, env) => {
  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 100);

  const failures = await getRecentFailures(env.DB, limit);
  return jsonSuccess(failures);
};
