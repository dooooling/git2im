/**
 * 定时清理任务模块 (Scheduled Cleanup Handler)
 *
 * 核心规范：
 * 1. 每日定时清理 30 天以前的历史 events 与 deliveries 元数据记录。
 * 2. 自动清理已过期的 previous GitHub Webhook Secret。
 */

import type { Env } from "../env";
import { cleanupOldEvents } from "../storage/events";
import { cleanupOldDeliveries } from "../storage/deliveries";
import { prepareDeleteSecretStatement } from "../security/secret-store";

export async function runScheduledCleanup(env: Env): Promise<{
  deletedEvents: number;
  deletedDeliveries: number;
  cleanedPreviousSecret: boolean;
}> {
  const now = Date.now();
  const retentionDays = 30;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  // 1. 清理过期 events 与 deliveries
  const [deletedEvents, deletedDeliveries] = await Promise.all([
    cleanupOldEvents(env.DB, cutoff),
    cleanupOldDeliveries(env.DB, cutoff),
  ]);

  // 2. 检查并清理过期的 previous GitHub Webhook Secret
  let cleanedPreviousSecret = false;
  const prevExpiresAtRow = await env.DB
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("github_webhook_secret_previous_expires_at")
    .first<{ value: string }>();

  if (prevExpiresAtRow?.value) {
    const prevExpiresAt = parseInt(prevExpiresAtRow.value, 10);
    if (!isNaN(prevExpiresAt) && prevExpiresAt < now) {
      const statements = [
        prepareDeleteSecretStatement(env.DB, "global", "github_webhook", "github_webhook_secret_previous"),
        env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind("github_webhook_secret_previous_expires_at"),
      ];
      await env.DB.batch(statements);
      cleanedPreviousSecret = true;
    }
  }

  return {
    deletedEvents,
    deletedDeliveries,
    cleanedPreviousSecret,
  };
}
