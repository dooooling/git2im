/**
 * 通知并发分发与超时调度器 (Notification Dispatcher)
 *
 * 核心规范：
 * 1. 同一事件并发投递最多 3 个 Target (CONCURRENCY = 3)。
 * 2. 整个 Webhook 投递总耗时预算控制在 8 秒内 (DEADLINE = 8000ms)，硬性保证在 GitHub 10 秒超时窗口前响应。
 * 3. 单个 Target 失败或超时，不得阻断其他 Target 的发送。
 */

import type { Env } from "../env";
import type { Target, DeliveryResult } from "./types";
import type { Notification } from "../notification/types";
import { getNotificationChannel } from "./registry";
import { channelTypeToProvider } from "./types";

export const MAX_CONCURRENT_TARGETS = 3;
export const TOTAL_DISPATCH_TIMEOUT_MS = 8000;

/**
 * 带有并发限制与全局 Deadline 预算的任务映射执行器
 */
export async function mapLimitWithDeadline<T, R>(
  items: T[],
  limit: number,
  totalDeadlineMs: number,
  task: (item: T) => Promise<R>,
  onDeadlineExceeded: (item: T) => R
): Promise<R[]> {
  const startTime = Date.now();
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (item === undefined) break;

      const elapsed = Date.now() - startTime;
      if (elapsed >= totalDeadlineMs) {
        // 预算耗尽，不再启动新任务
        results[index] = onDeadlineExceeded(item);
        continue;
      }

      try {
        results[index] = await task(item);
      } catch {
        results[index] = onDeadlineExceeded(item);
      }
    }
  }

  // 启动并发 worker 线程池
  const poolSize = Math.min(limit, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < poolSize; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * 并发投递通知到多个目标
 *
 * @param env Cloudflare Bindings 环境变量
 * @param targets 去重后的目标列表 (最多 6 个)
 * @param notification 标准化通知对象
 * @returns 各目标的投递结果数组
 */
export async function dispatchNotificationToTargets(
  env: Env,
  targets: Target[],
  notification: Notification
): Promise<DeliveryResult[]> {
  if (targets.length === 0) {
    return [];
  }

  return await mapLimitWithDeadline(
    targets,
    MAX_CONCURRENT_TARGETS,
    TOTAL_DISPATCH_TIMEOUT_MS,
    async (target) => {
      const channel = getNotificationChannel(target.type);
      if (!channel) {
        return {
          targetId: target.id,
          provider: channelTypeToProvider(target.type),
          channelType: target.type,
          success: false,
          errorCode: "CHANNEL_NOT_SUPPORTED",
          errorSummary: `Channel adapter for ${target.type} is not registered`,
          durationMs: 0,
        };
      }

      return await channel.send(env, target, notification);
    },
    (target) => ({
      targetId: target.id,
      provider: channelTypeToProvider(target.type),
      channelType: target.type,
      success: false,
      errorCode: "PROVIDER_DEADLINE_EXCEEDED",
      errorSummary: "Webhook dispatch total deadline (8s) exceeded before starting this target",
      durationMs: 0,
    })
  );
}
